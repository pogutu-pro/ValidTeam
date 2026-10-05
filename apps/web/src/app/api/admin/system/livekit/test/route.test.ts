/** @jest-environment node */

const authMock = jest.fn();
const isSuperAdminMock = jest.fn();
const resolveLivekitConfigMock = jest.fn();
const listRoomsMock = jest.fn();
const toJwtMock = jest.fn();
const addGrantMock = jest.fn();
const auditEvents: string[] = [];
const auditRows: Array<Record<string, unknown>> = [];
const roomServiceConstructorMock = jest.fn();
let failingAuditAction: string | null = null;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  isSuperAdmin: (...args: unknown[]) => isSuperAdminMock(...args),
}));
jest.mock('@/lib/admin/system-settings', () => ({
  resolveLivekitConfig: (...args: unknown[]) => resolveLivekitConfigMock(...args),
}));
jest.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class RoomServiceClient {
    constructor(...args: unknown[]) {
      roomServiceConstructorMock(...args);
    }
    listRooms() {
      auditEvents.push('listRooms');
      return listRoomsMock();
    }
  },
  AccessToken: class AccessToken {
    addGrant = addGrantMock;
    toJwt = toJwtMock;
  },
}));
jest.mock('@validteam/db', () => ({
  systemAuditLogs: { id: 'system_audit_logs.id' },
  db: {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (row.action === failingAuditAction) throw new Error('audit unavailable');
        auditRows.push(row);
        auditEvents.push(`audit:${String(row.action)}`);
      },
    }),
  },
}));

import { POST } from './route';

describe('POST /api/admin/system/livekit/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents.length = 0;
    auditRows.length = 0;
    failingAuditAction = null;
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    isSuperAdminMock.mockResolvedValue(true);
    resolveLivekitConfigMock.mockResolvedValue({
      source: 'db',
      url: 'wss://livekit.example.com',
      apiKey: 'api-key',
      apiSecret: 'api-secret',
    });
    listRoomsMock.mockResolvedValue([{ name: 'one' }, { name: 'two' }]);
    toJwtMock.mockResolvedValue('header.payload.signature');
  });

  it('verifies server credentials before minting a token and records success', async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      activeRoomCount: 2,
    });
    expect(roomServiceConstructorMock).toHaveBeenCalledWith(
      'wss://livekit.example.com',
      'api-key',
      'api-secret',
      { requestTimeout: 5 }
    );
    expect(auditEvents).toEqual([
      'audit:system.livekit_test_requested',
      'listRooms',
      'audit:system.livekit_test_ok',
    ]);
    expect(auditRows[1]?.metadata).toMatchObject({ activeRoomCount: 2 });
  });

  it('returns a failed verification and audits the real connection error', async () => {
    listRoomsMock.mockRejectedValue(new Error('unauthenticated'));

    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'livekit_test_failed',
    });
    expect(toJwtMock).not.toHaveBeenCalled();
    expect(auditEvents).toEqual([
      'audit:system.livekit_test_requested',
      'listRooms',
      'audit:system.livekit_test_failed',
    ]);
  });

  it('reports a successful verification whose audit outcome could not be recorded', async () => {
    failingAuditAction = 'system.livekit_test_ok';

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'livekit_test_outcome_unrecorded',
    });
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed verification whose audit outcome could not be recorded', async () => {
    listRoomsMock.mockRejectedValue(new Error('unauthenticated'));
    failingAuditAction = 'system.livekit_test_failed';

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'livekit_test_outcome_unrecorded',
    });
  });
});
