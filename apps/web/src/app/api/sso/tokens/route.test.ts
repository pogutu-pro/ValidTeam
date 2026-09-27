/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const tokenRows: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];
const locks: Array<{ values?: unknown[] }> = [];

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/sso/tokens', () => ({
  generateScimToken: () => ({ token: 'scim_secret', prefix: 'scim_secret' }),
  hashScimToken: async () => 'bcrypt-hash',
  digestScimToken: () => 'sha256-digest',
}));
jest.mock('@tasknebula/db', () => {
  const tokenTable = { tableName: 'scim_tokens' };
  const auditTable = { tableName: 'audit_logs' };
  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      locks.push(query);
    },
    insert: (table: { tableName?: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table.tableName === tokenTable.tableName) {
          tokenRows.push(row);
          return {
            returning: async () => [
              {
                id: 'token_1',
                name: row.name,
                tokenPrefix: row.tokenPrefix,
                scopes: row.scopes,
                createdAt: new Date('2026-08-20T10:00:00.000Z'),
              },
            ],
          };
        }
        if (table.tableName === auditTable.tableName) auditRows.push(row);
        return Promise.resolve();
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
      scopes: 'scimTokens.scopes',
      createdAt: 'scimTokens.createdAt',
      lastUsedAt: 'scimTokens.lastUsedAt',
      revokedAt: 'scimTokens.revokedAt',
    },
    desc: (...args: unknown[]) => ({ desc: args }),
    eq: (...args: unknown[]) => ({ eq: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/sso/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sso/tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenRows.length = 0;
    auditRows.length = 0;
    locks.length = 0;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('persists explicit scopes, the lookup metadata, creator, and audit atomically', async () => {
    const response = await POST(
      request({ organizationId: 'org_1', name: 'Entra production', scopes: ['users:read'] })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: 'scim_secret',
      id: 'token_1',
      tokenPrefix: 'scim_secret',
      scopes: ['users:read'],
    });
    expect(tokenRows).toEqual([
      expect.objectContaining({
        workspaceId: 'org_1',
        name: 'Entra production',
        tokenHash: 'bcrypt-hash',
        tokenDigest: 'sha256-digest',
        tokenPrefix: 'scim_secret',
        scopes: ['users:read'],
        createdBy: 'user_1',
      }),
    ]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        userId: 'user_1',
        organizationId: 'org_1',
        action: 'scim_token.created',
        resourceId: 'token_1',
      }),
    ]);
    expect(locks[0]?.values).toContain('scim-token:org_1');
  });

  it('rejects empty or unknown scopes before hashing or writing', async () => {
    const empty = await POST(request({ organizationId: 'org_1', name: 'Empty', scopes: [] }));
    const unknown = await POST(
      request({ organizationId: 'org_1', name: 'Root', scopes: ['root:write'] })
    );

    expect(empty.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(tokenRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('does not create a token without workspace settings permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await POST(
      request({ organizationId: 'org_1', name: 'Denied', scopes: ['users:read'] })
    );

    expect(response.status).toBe(403);
    expect(tokenRows).toHaveLength(0);
  });
});
