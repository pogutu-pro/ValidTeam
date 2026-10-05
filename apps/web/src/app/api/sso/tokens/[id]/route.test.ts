/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
const updateRows: Array<Record<string, unknown>> = [];
const locks: Array<{ values?: unknown[] }> = [];
let tokenRow: Record<string, unknown> | null;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@validteam/db', () => {
  const tokenTable = { name: 'scim_tokens' };
  const auditTable = { name: 'audit_logs' };
  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      locks.push(query);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ for: async () => (tokenRow ? [tokenRow] : []) }),
        }),
      }),
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          updateRows.push(row);
        },
      }),
    }),
    insert: (table: { name?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table.name === auditTable.name) auditRows.push(row);
      },
    }),
  };
  return {
    auditLogs: auditTable,
    scimTokens: {
      ...tokenTable,
      id: 'scimTokens.id',
      workspaceId: 'scimTokens.workspaceId',
      name: 'scimTokens.name',
      tokenPrefix: 'scimTokens.tokenPrefix',
      revokedAt: 'scimTokens.revokedAt',
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (tokenRow ? [tokenRow] : []) }),
        }),
      }),
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { DELETE } from './route';

function request() {
  return new NextRequest('http://localhost/api/sso/tokens/token_1', { method: 'DELETE' });
}

describe('DELETE /api/sso/tokens/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    updateRows.length = 0;
    locks.length = 0;
    tokenRow = {
      id: 'token_1',
      workspaceId: 'org_1',
      name: 'Okta production',
      tokenPrefix: 'scim_abcdefg',
      revokedAt: null,
    };
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('revokes and audits once under a token lock', async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id: 'token_1' }) });

    expect(response.status).toBe(200);
    expect(updateRows).toHaveLength(1);
    expect(updateRows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'scim_token.revoked',
        organizationId: 'org_1',
        resourceId: 'token_1',
      }),
    ]);
    expect(locks[0]?.values).toContain('scim-token:token_1');
  });

  it('is idempotent for an already revoked token', async () => {
    tokenRow = { ...tokenRow, revokedAt: new Date('2026-08-20T00:00:00.000Z') };

    const response = await DELETE(request(), { params: Promise.resolve({ id: 'token_1' }) });

    expect(response.status).toBe(200);
    expect(updateRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('does not reveal a cross-workspace token to an unauthorized caller', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await DELETE(request(), { params: Promise.resolve({ id: 'token_1' }) });

    expect(response.status).toBe(404);
    expect(updateRows).toHaveLength(0);
    expect(locks).toHaveLength(0);
  });
});
