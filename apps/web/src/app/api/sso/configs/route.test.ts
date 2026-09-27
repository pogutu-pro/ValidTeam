/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
const savedRows: Array<Record<string, unknown>> = [];
const locks: Array<{ values?: unknown[] }> = [];
let existing: Record<string, unknown> | null = null;
let deleteCount = 0;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/sso/config-validation', () => ({
  certificateFingerprint: (value: string | null | undefined) =>
    value ? `fingerprint:${value}` : null,
  normalizeSamlCertificate: (value: string) => `normalized:${value}`,
  normalizeSamlEntryPoint: (value: string) => value,
  normalizeSamlPrivateKey: (value: string) => value,
  SamlConfigValidationError: class SamlConfigValidationError extends Error {},
}));
jest.mock('@/lib/sso/private-key', () => ({
  protectSsoPrivateKey: (value: string) => (value.startsWith('enc:') ? value : `enc:${value}`),
}));
jest.mock('@tasknebula/db', () => {
  const configTable = { tableName: 'sso_configs' };
  const auditTable = { tableName: 'audit_logs' };
  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      locks.push(query);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ for: async () => (existing ? [existing] : []) }),
        }),
      }),
    }),
    insert: (table: { tableName?: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table.tableName === auditTable.tableName) {
          auditRows.push(row);
          return Promise.resolve();
        }
        savedRows.push(row);
        return {
          returning: async () => [
            {
              id: 'config_1',
              createdAt: new Date('2026-08-20T00:00:00.000Z'),
              ...row,
            },
          ],
        };
      },
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            savedRows.push(row);
            return [{ ...existing, ...row }];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        deleteCount += 1;
      },
    }),
  };
  return {
    auditLogs: auditTable,
    ssoConfigs: {
      ...configTable,
      id: 'ssoConfigs.id',
      workspaceId: 'ssoConfigs.workspaceId',
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { DELETE, POST } from './route';

const validBody = {
  organizationId: 'org_1',
  provider: 'saml',
  entryPointUrl: 'https://idp.example.com/sso',
  issuer: 'https://idp.example.com',
  cert: 'certificate',
  audience: 'https://tasks.example.com/saml/sp',
  attributeMap: { email: 'mail', first_name: 'given', last_name: 'surname', groups: 'groups' },
  enabled: true,
};

function post(body: unknown) {
  return new NextRequest('http://localhost/api/sso/configs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function removeRequest() {
  return new NextRequest('http://localhost/api/sso/configs?organizationId=org_1', {
    method: 'DELETE',
  });
}

describe('/api/sso/configs lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    savedRows.length = 0;
    locks.length = 0;
    deleteCount = 0;
    existing = null;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('creates a config with an encrypted private key and an atomic audit row', async () => {
    const response = await POST(post({ ...validBody, privateKey: 'private-pem' }));

    expect(response.status).toBe(200);
    expect(savedRows[0]).toMatchObject({
      privateKey: 'enc:private-pem',
      cert: 'normalized:certificate',
      audience: validBody.audience,
    });
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'sso_config.created',
        organizationId: 'org_1',
        resourceId: 'config_1',
      }),
    ]);
    expect(locks[0]?.values).toContain('sso-config:org_1');
  });

  it('preserves an existing private key when the field is omitted', async () => {
    existing = {
      id: 'config_1',
      workspaceId: 'org_1',
      provider: 'saml',
      entryPointUrl: 'https://old.example.com/sso',
      issuer: 'old-issuer',
      cert: 'old-cert',
      privateKey: 'enc:existing-key',
      audience: 'old-audience',
      attributeMap: {},
      enabled: false,
    };

    const response = await POST(post(validBody));

    expect(response.status).toBe(200);
    expect(savedRows[0]?.privateKey).toBe('enc:existing-key');
    expect(auditRows[0]).toMatchObject({ action: 'sso_config.updated' });
  });

  it('clears a private key only through the explicit clear action', async () => {
    existing = {
      id: 'config_1',
      workspaceId: 'org_1',
      privateKey: 'enc:existing-key',
      enabled: true,
    };

    const response = await POST(post({ ...validBody, clearPrivateKey: true }));

    expect(response.status).toBe(200);
    expect(savedRows[0]?.privateKey).toBeNull();
  });

  it('deletes the configuration and records the prior security posture', async () => {
    existing = {
      id: 'config_1',
      workspaceId: 'org_1',
      provider: 'saml',
      cert: 'old-cert',
      privateKey: 'enc:existing-key',
      enabled: true,
    };

    const response = await DELETE(removeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: true });
    expect(deleteCount).toBe(1);
    expect(auditRows[0]).toMatchObject({
      action: 'sso_config.deleted',
      metadata: expect.objectContaining({ privateKeyConfigured: true }),
    });
  });

  it('rejects mutations without workspace settings permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await POST(post(validBody));

    expect(response.status).toBe(403);
    expect(savedRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });
});
