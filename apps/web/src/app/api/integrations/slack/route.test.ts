/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const asTokenEnvelopeMock = jest.fn();
const decryptTokenMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
const locks: Array<{ values?: unknown[] }> = [];
let connection: Record<string, unknown> | null;
let deleteCount = 0;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/integrations/token-crypto', () => ({
  asTokenEnvelope: (...args: unknown[]) => asTokenEnvelopeMock(...args),
  decryptToken: (...args: unknown[]) => decryptTokenMock(...args),
}));
jest.mock('@tasknebula/db/src/schema/integration-connections', () => ({
  integrationConnections: {
    name: 'integration_connections',
    id: 'integration.id',
    organizationId: 'integration.organizationId',
    provider: 'integration.provider',
  },
}));
jest.mock('@tasknebula/db', () => {
  const auditTable = { name: 'audit_logs' };
  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      locks.push(query);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (connection ? [connection] : []),
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        deleteCount += 1;
      },
    }),
    insert: (table: { name?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table.name === auditTable.name) auditRows.push(row);
      },
    }),
  };
  return {
    auditLogs: auditTable,
    and: (...args: unknown[]) => ({ and: args }),
    eq: (...args: unknown[]) => ({ eq: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { DELETE } from './route';

function request() {
  return new NextRequest('http://localhost/api/integrations/slack?organizationId=org_1', {
    method: 'DELETE',
  });
}

describe('DELETE /api/integrations/slack', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    locks.length = 0;
    deleteCount = 0;
    connection = {
      id: 'connection_1',
      accessTokenEnc: { envelope: true },
      externalAccountId: 'T123',
    };
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    asTokenEnvelopeMock.mockReturnValue({ envelope: true });
    decryptTokenMock.mockReturnValue('xoxb-secret');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('revokes upstream, deletes locally, and audits under the OAuth organization lock', async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      alreadyDisconnected: false,
      revokeSucceeded: true,
    });
    expect(locks[0]?.values).toContain('slack-organization:org_1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/auth.revoke',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    );
    expect(deleteCount).toBe(1);
    expect(auditRows).toEqual([
      expect.objectContaining({
        resourceId: 'connection_1',
        metadata: {
          kind: 'slack_disconnected',
          workspaceId: 'T123',
          revokeSucceeded: true,
        },
      }),
    ]);
  });

  it('still removes local credentials when Slack rejects the revoke', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    });

    const response = await DELETE(request());

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      revokeSucceeded: false,
    });
    expect(deleteCount).toBe(1);
    expect(auditRows[0]?.metadata).toMatchObject({ revokeSucceeded: false });
  });

  it('is idempotent when the connection is already absent', async () => {
    connection = null;

    const response = await DELETE(request());

    await expect(response.json()).resolves.toEqual({
      ok: true,
      alreadyDisconnected: true,
      revokeSucceeded: null,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(deleteCount).toBe(0);
    expect(auditRows).toHaveLength(0);
  });
});
