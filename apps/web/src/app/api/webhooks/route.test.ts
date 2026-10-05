/** @jest-environment node */

import { NextRequest } from 'next/server';
import { UnsafeAgentProviderEndpointError } from '@/lib/agents/provider-endpoint';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const validateWebhookEndpointMock = jest.fn();
const createdRows: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];
let mockOrganizationExists = true;
let mockProjectExists = true;

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
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  ne: (...args: unknown[]) => ({ ne: args }),
}));
jest.mock('@validteam/db', () => {
  const webhookTable = { name: 'webhooks' };
  const auditTable = { name: 'audit_logs' };
  const organizationTable = { name: 'organizations' };
  const projectTable = { name: 'projects' };
  const tx = {
    select: () => ({
      from: (table: { name: string }) => ({
        where: () => ({
          limit: () => ({
            for: async () => {
              if (table.name === organizationTable.name) {
                return mockOrganizationExists ? [{ id: 'org_1' }] : [];
              }
              if (table.name === projectTable.name) {
                return mockProjectExists ? [{ id: 'project_1' }] : [];
              }
              return [];
            },
          }),
        }),
      }),
    }),
    insert: (table: { name: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table.name === webhookTable.name) {
          createdRows.push(row);
          return {
            returning: async () => [
              {
                id: 'webhook_1',
                ...row,
                isActive: true,
                successCount: 0,
                failureCount: 0,
              },
            ],
          };
        }
        if (table.name === auditTable.name) auditRows.push(row);
        return Promise.resolve();
      },
    }),
  };
  return {
    auditLogs: auditTable,
    organizations: {
      ...organizationTable,
      id: 'organizations.id',
      status: 'organizations.status',
    },
    projects: {
      ...projectTable,
      id: 'projects.id',
      organizationId: 'projects.organizationId',
    },
    webhooks: {
      ...webhookTable,
      organizationId: 'webhooks.organizationId',
      projectId: 'webhooks.projectId',
    },
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdRows.length = 0;
    auditRows.length = 0;
    mockOrganizationExists = true;
    mockProjectExists = true;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    validateWebhookEndpointMock.mockResolvedValue('https://hooks.example.com/receive');
  });

  const validBody = {
    name: 'Issue stream',
    url: 'https://hooks.example.com/receive',
    organizationId: 'org_1',
    projectId: 'project_1',
    events: ['issue.created'],
  };

  it('creates a project-scoped webhook and its audit row atomically', async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(201);
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      organizationId: 'org_1',
      projectId: 'project_1',
      url: 'https://hooks.example.com/receive',
      events: ['issue.created'],
      createdBy: 'user_1',
    });
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'webhook.created',
        resourceId: 'webhook_1',
        organizationId: 'org_1',
        projectId: 'project_1',
      }),
    ]);
    expect(hasPermissionMock).toHaveBeenCalledWith('org_1', 'webhook:create');
  });

  it('rejects a project that does not belong to the requested workspace', async () => {
    mockProjectExists = false;

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'webhook_scope_invalid' });
    expect(createdRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects an unsafe destination without writing configuration', async () => {
    validateWebhookEndpointMock.mockRejectedValue(
      new UnsafeAgentProviderEndpointError('not public')
    );

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'webhook_url_unsafe' });
    expect(createdRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('accepts only the documented event enum and unique subscriptions', async () => {
    const unknownEvent = await POST(request({ ...validBody, events: ['issue.created', 'root'] }));
    const duplicateEvent = await POST(
      request({ ...validBody, events: ['issue.created', 'issue.created'] })
    );

    expect(unknownEvent.status).toBe(400);
    expect(duplicateEvent.status).toBe(400);
    expect(validateWebhookEndpointMock).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
  });
});
