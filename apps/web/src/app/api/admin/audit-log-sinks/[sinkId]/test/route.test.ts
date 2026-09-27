/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const deliverToSinkMock = jest.fn();
const persistSinkOutcomeMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
let transactionFails = false;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/audit/sink-dispatcher', () => ({
  deliverToSink: (...args: unknown[]) => deliverToSinkMock(...args),
  persistSinkOutcome: (...args: unknown[]) => persistSinkOutcomeMock(...args),
}));
jest.mock('@tasknebula/db', () => {
  const tx = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        auditRows.push(row);
      },
    }),
  };
  return {
    auditLogSinks: { id: 'auditLogSinks.id' },
    systemAuditLogs: {},
    eq: (...args: unknown[]) => ({ eq: args }),
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                id: 'sink_1',
                workspaceId: 'org_1',
                type: 'webhook',
                name: 'SIEM',
                config: { url: 'https://siem.example.com' },
                signingSecret: 'secret',
                successCount: '0',
                failureCount: '0',
              },
            ],
          }),
        }),
      }),
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
        if (transactionFails) throw new Error('database unavailable');
        return callback(tx);
      },
    },
  };
});

import { POST } from './route';

function request() {
  return new NextRequest('http://localhost/api/admin/audit-log-sinks/sink_1/test', {
    method: 'POST',
  });
}

describe('POST /api/admin/audit-log-sinks/:id/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    transactionFails = false;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    deliverToSinkMock.mockResolvedValue({
      sinkId: 'sink_1',
      type: 'webhook',
      ok: true,
      statusCode: 204,
      durationMs: 12,
      error: null,
    });
    persistSinkOutcomeMock.mockResolvedValue(undefined);
  });

  it('persists the counter and audit row in one transaction after delivery', async () => {
    const response = await POST(request(), { params: Promise.resolve({ sinkId: 'sink_1' }) });

    expect(response.status).toBe(200);
    expect(persistSinkOutcomeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sink_1' }),
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ insert: expect.any(Function) })
    );
    expect(auditRows[0]).toMatchObject({ action: 'audit_sink.test_ok', resourceId: 'sink_1' });
  });

  it('returns the delivery failure only after recording its counter and audit', async () => {
    deliverToSinkMock.mockResolvedValue({
      sinkId: 'sink_1',
      type: 'webhook',
      ok: false,
      statusCode: 500,
      durationMs: 15,
      error: 'HTTP 500',
    });

    const response = await POST(request(), { params: Promise.resolve({ sinkId: 'sink_1' }) });

    expect(response.status).toBe(502);
    expect(auditRows[0]).toMatchObject({ action: 'audit_sink.test_failed' });
  });

  it('does not claim a tracked result when outcome persistence fails', async () => {
    transactionFails = true;

    const response = await POST(request(), { params: Promise.resolve({ sinkId: 'sink_1' }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'audit_sink_test_outcome_unrecorded',
      deliveryUncertain: true,
    });
  });
});
