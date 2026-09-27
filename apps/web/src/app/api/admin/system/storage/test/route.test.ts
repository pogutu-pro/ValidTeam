/** @jest-environment node */

const authMock = jest.fn();
const isSuperAdminMock = jest.fn();
const resolveStorageConfigMock = jest.fn();
const writeStoredFileMock = jest.fn();
const readStoredFileMock = jest.fn();
const deleteStoredFileMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
const locks: Array<{ values?: unknown[] }> = [];
let failOutsideAudit = false;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  isSuperAdmin: (...args: unknown[]) => isSuperAdminMock(...args),
}));
jest.mock('@/lib/admin/system-settings', () => ({
  STORAGE_CONFIG_ADVISORY_LOCK: 'storage-config-lock',
  resolveStorageConfig: (...args: unknown[]) => resolveStorageConfigMock(...args),
}));
jest.mock('@/lib/storage/blob-store', () => ({
  writeStoredFile: (...args: unknown[]) => writeStoredFileMock(...args),
  readStoredFile: (...args: unknown[]) => readStoredFileMock(...args),
  deleteStoredFile: (...args: unknown[]) => deleteStoredFileMock(...args),
}));
jest.mock('@tasknebula/db', () => {
  const auditTable = { tableName: 'system_audit_logs' };
  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      locks.push(query);
    },
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        auditRows.push(row);
      },
    }),
  };
  return {
    systemAuditLogs: auditTable,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (failOutsideAudit) throw new Error('audit unavailable');
          auditRows.push(row);
        },
      }),
    },
  };
});

import { POST } from './route';

describe('POST /api/admin/system/storage/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    locks.length = 0;
    failOutsideAudit = false;
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    isSuperAdminMock.mockResolvedValue(true);
    resolveStorageConfigMock.mockResolvedValue({ source: 'database', mode: 'local' });
    writeStoredFileMock.mockResolvedValue(undefined);
    readStoredFileMock.mockImplementation(async (_filename: string) => {
      const writeBody = writeStoredFileMock.mock.calls[0]?.[1];
      return Buffer.from(writeBody);
    });
    deleteStoredFileMock.mockResolvedValue(undefined);
  });

  it('writes, reads, deletes, and audits one real round trip under the config lock', async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      source: 'database',
      mode: 'local',
    });
    expect(writeStoredFileMock).toHaveBeenCalledTimes(1);
    expect(readStoredFileMock).toHaveBeenCalledTimes(1);
    expect(deleteStoredFileMock).toHaveBeenCalledTimes(1);
    expect(locks[0]?.values).toContain('storage-config-lock');
    expect(auditRows[0]).toMatchObject({ action: 'system.storage_test_ok' });
  });

  it('cleans up a written probe and records a failed round trip', async () => {
    readStoredFileMock.mockRejectedValue(new Error('read failed'));

    const response = await POST();

    expect(response.status).toBe(502);
    expect(deleteStoredFileMock).toHaveBeenCalledTimes(1);
    expect(auditRows).toEqual([expect.objectContaining({ action: 'system.storage_test_failed' })]);
  });

  it('does not claim a tracked failure when the failure audit cannot be written', async () => {
    writeStoredFileMock.mockRejectedValue(new Error('write failed'));
    failOutsideAudit = true;

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'storage_test_outcome_unrecorded',
      deliveryUncertain: true,
    });
  });
});
