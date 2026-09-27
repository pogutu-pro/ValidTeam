/** @jest-environment node */

import { NextRequest } from 'next/server';
import { UnsafeAgentProviderEndpointError } from '@/lib/agents/provider-endpoint';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const validateWebhookEndpointMock = jest.fn();
const auditRows: Array<Record<string, unknown>> = [];
let currentWebhook: Record<string, unknown> | null;
let transactionCount = 0;
let deletedCount = 0;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/webhooks/dispatcher', () => ({
  WEBHOOK_EVENTS: [
    'issue.created',
    'issue.updated',
    'issue.deleted',
    'issue.status_changed',
    'issue.assigned',
    'issue.commented',
    'sprint.started',
    'sprint.completed',
    'project.created',
    'project.updated',
  ],
}));
jest.mock('@/lib/webhooks/url-policy', () => ({
  validateWebhookEndpoint: (...args: unknown[]) => validateWebhookEndpointMock(...args),
}));
jest.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
}));
jest.mock('@tasknebula/db', () => {
  const webhookTable = { name: 'webhooks', id: 'webhooks.id' };
  const auditTable = { name: 'audit_logs' };

  function selectChain() {
    return {
      from: () => ({
        where: () => ({
          limit: () => {
            const rows = () => (currentWebhook ? [currentWebhook] : []);
            return {
              then: (resolve: (value: Record<string, unknown>[]) => unknown) =>
                Promise.resolve(rows()).then(resolve),
              for: async () => rows(),
            };
          },
        }),
      }),
    };
  }

  const tx = {
    select: selectChain,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (!currentWebhook) return [];
            currentWebhook = { ...currentWebhook, ...values };
            return [currentWebhook];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        deletedCount += 1;
      },
    }),
    insert: (table: { name: string }) => ({
      values: async (row: Record<string, unknown>) => {
        if (table.name === auditTable.name) auditRows.push(row);
      },
    }),
  };

  return {
    auditLogs: auditTable,
    webhooks: webhookTable,
    db: {
      select: selectChain,
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1;
        return callback(tx);
      },
    },
  };
});

import { DELETE, PATCH } from './route';

const routeContext = { params: Promise.resolve({ webhookId: 'webhook_1' }) };

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/webhooks/webhook_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/webhooks/[webhookId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRows.length = 0;
    transactionCount = 0;
    deletedCount = 0;
    currentWebhook = {
      id: 'webhook_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      name: 'Original',
      url: 'https://hooks.example.com/old',
      events: ['issue.created'],
      isActive: true,
    };
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    validateWebhookEndpointMock.mockResolvedValue('https://hooks.example.com/new');
  });

  it('updates configuration under a row lock and writes a redacted audit change', async () => {
    const response = await PATCH(
      patchRequest({ name: 'Renamed', url: 'https://hooks.example.com/new' }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(transactionCount).toBe(1);
    expect(currentWebhook).toMatchObject({
      name: 'Renamed',
      url: 'https://hooks.example.com/new',
    });
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'webhook.updated',
        resourceId: 'webhook_1',
        changes: expect.objectContaining({
          name: { from: 'Original', to: 'Renamed' },
          url: { from: 'configured', to: 'updated' },
        }),
      }),
    ]);
  });

  it('rejects unsafe URL changes before opening a mutation transaction', async () => {
    validateWebhookEndpointMock.mockRejectedValue(
      new UnsafeAgentProviderEndpointError('not public')
    );

    const response = await PATCH(patchRequest({ url: 'https://127.0.0.1/private' }), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'webhook_url_unsafe' });
    expect(transactionCount).toBe(0);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects empty or unsupported partial updates', async () => {
    const empty = await PATCH(patchRequest({}), routeContext);
    const unsupported = await PATCH(patchRequest({ organizationId: 'org_2' }), routeContext);

    expect(empty.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(transactionCount).toBe(0);
  });

  it('deletes the row and writes its audit record in one transaction', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/webhooks/webhook_1', { method: 'DELETE' }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(deletedCount).toBe(1);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'webhook.deleted',
        organizationId: 'org_1',
        projectId: 'project_1',
      }),
    ]);
  });

  it('does not mutate when the actor lacks the owning workspace permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const response = await PATCH(patchRequest({ isActive: false }), routeContext);

    expect(response.status).toBe(403);
    expect(transactionCount).toBe(0);
  });
});
