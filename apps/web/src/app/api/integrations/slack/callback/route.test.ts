/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const exchangeSlackCodeMock = jest.fn();
const encryptTokenMock = jest.fn((value: string) => ({ encrypted: value }));
const auditRows: Array<Record<string, unknown>> = [];
const connectionRows: Array<Record<string, unknown>> = [];
const updatedRows: Array<Record<string, unknown>> = [];
const executedLocks: unknown[] = [];
let otherOwner: Record<string, unknown> | null = null;
let existingConnection: Record<string, unknown> | null = null;
let transactionError: Error | null = null;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/integrations/token-crypto', () => ({
  encryptToken: (...args: unknown[]) => encryptTokenMock(...(args as [string])),
}));
jest.mock('@/lib/integrations/slack', () => ({
  SLACK_PROVIDER: 'slack',
  SLACK_STATE_COOKIE: 'slack-state',
  exchangeSlackCode: (...args: unknown[]) => exchangeSlackCodeMock(...args),
}));
jest.mock('@/lib/integrations/mobile-oauth', () => ({
  isMobileIntegrationState: () => false,
  decodeMobileIntegrationState: () => null,
  hasPermissionForUser: jest.fn(),
  mobileIntegrationRedirect: jest.fn(),
}));
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'connection_new' }));
jest.mock('@validteam/db/src/schema/integration-connections', () => ({
  integrationConnections: {
    name: 'integration_connections',
    id: 'integration_connections.id',
    provider: 'integration_connections.provider',
    externalAccountId: 'integration_connections.externalAccountId',
    organizationId: 'integration_connections.organizationId',
  },
}));
jest.mock('@validteam/db', () => {
  const auditTable = { name: 'audit_logs' };
  let selectIndex = 0;
  const tx = {
    execute: async (query: unknown) => {
      executedLocks.push(query);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const result = selectIndex === 0 ? otherOwner : existingConnection;
            selectIndex += 1;
            return result ? [result] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          updatedRows.push(row);
        },
      }),
    }),
    insert: (table: { name?: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table.name === auditTable.name) auditRows.push(row);
        else connectionRows.push(row);
      },
    }),
  };
  return {
    auditLogs: auditTable,
    and: (...args: unknown[]) => ({ and: args }),
    eq: (...args: unknown[]) => ({ eq: args }),
    ne: (...args: unknown[]) => ({ ne: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
        selectIndex = 0;
        if (transactionError) throw transactionError;
        return callback(tx);
      },
    },
  };
});

import { GET } from './route';

function state() {
  return Buffer.from(JSON.stringify({ n: 'nonce', o: 'org_1', u: 'user_1' })).toString('base64url');
}

function request() {
  const value = state();
  return new NextRequest(
    `http://localhost/api/integrations/slack/callback?code=abc&state=${value}`,
    {
      headers: { cookie: `slack-state=${value}` },
    }
  );
}

function redirectQuery(response: Response) {
  return new URL(response.headers.get('location')!).searchParams;
}

describe('Slack OAuth callback workspace identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    connectionRows.length = 0;
    updatedRows.length = 0;
    executedLocks.length = 0;
    otherOwner = null;
    existingConnection = null;
    transactionError = null;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    exchangeSlackCodeMock.mockResolvedValue({
      ok: true,
      access_token: 'xoxb-secret',
      team: { id: 'T123', name: 'Acme' },
      bot_user_id: 'B123',
      authed_user: { id: 'U123' },
      scope: 'commands,chat:write',
    });
  });

  it('persists a new connection and audit row under workspace and organization locks', async () => {
    const response = await GET(request());

    expect(redirectQuery(response).get('connected')).toBe('1');
    expect(executedLocks).toHaveLength(2);
    expect(connectionRows).toEqual([
      expect.objectContaining({
        id: 'connection_new',
        organizationId: 'org_1',
        externalAccountId: 'T123',
        connectedById: 'user_1',
      }),
    ]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'organization.updated',
        resourceType: 'integration_connection',
        resourceId: 'connection_new',
        metadata: expect.objectContaining({ kind: 'slack_connected', workspaceId: 'T123' }),
      }),
    ]);
  });

  it('refuses a Slack workspace already owned by another organization', async () => {
    otherOwner = { id: 'connection_other' };

    const response = await GET(request());

    expect(redirectQuery(response).get('error')).toBe('workspace_already_connected');
    expect(connectionRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('requires explicit disconnect before switching an organization to another workspace', async () => {
    existingConnection = { id: 'connection_old', workspaceId: 'T_OLD' };

    const response = await GET(request());

    expect(redirectQuery(response).get('error')).toBe('disconnect_existing_workspace_first');
    expect(updatedRows).toHaveLength(0);
  });

  it('maps a database unique violation to a stable code without leaking its message', async () => {
    const error = new Error('duplicate key value violates unique constraint secret_index');
    Object.assign(error, { code: '23505' });
    transactionError = error;

    const response = await GET(request());
    const location = response.headers.get('location')!;

    expect(redirectQuery(response).get('error')).toBe('workspace_already_connected');
    expect(location).not.toContain('secret_index');
    expect(location).not.toContain('duplicate');
  });
});
