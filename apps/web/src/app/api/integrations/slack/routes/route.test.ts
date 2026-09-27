/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const executedLocks: Array<{ values?: unknown[] }> = [];
const routeWrites: Array<Record<string, unknown>> = [];
const auditRows: Array<Record<string, unknown>> = [];
let connectedTeamId: string | null = 'T123';
let projectExists = true;
let existingRoute: { id: string; projectId?: string } | null = null;
let deleteCount = 0;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@tasknebula/db', () => {
  const integrationTable = {
    name: 'integration_connections',
    organizationId: 'integration.organizationId',
    provider: 'integration.provider',
    externalAccountId: 'integration.externalAccountId',
  };
  const organizationTable = { name: 'organizations', id: 'organizations.id', status: 'status' };
  const projectTable = {
    name: 'projects',
    id: 'projects.id',
    organizationId: 'projects.organizationId',
    status: 'projects.status',
  };
  const routeTable = {
    name: 'slack_channel_routes',
    id: 'routes.id',
    organizationId: 'routes.organizationId',
    slackTeamId: 'routes.slackTeamId',
    slackChannelId: 'routes.slackChannelId',
    projectId: 'routes.projectId',
  };
  const auditTable = { name: 'audit_logs' };

  function selectFrom(table: { name: string }) {
    const result = () => {
      if (table.name === integrationTable.name) {
        return connectedTeamId ? [{ slackTeamId: connectedTeamId }] : [];
      }
      if (table.name === projectTable.name) return projectExists ? [{ id: 'project_1' }] : [];
      if (table.name === routeTable.name) return existingRoute ? [existingRoute] : [];
      return [];
    };
    const chain: Record<string, unknown> = {};
    chain.innerJoin = () => chain;
    chain.where = () => ({
      limit: async () => result(),
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result()).then(resolve),
    });
    return chain;
  }

  const tx = {
    execute: async (query: { values?: unknown[] }) => {
      executedLocks.push(query);
    },
    select: () => ({ from: selectFrom }),
    insert: (table: { name: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table.name === auditTable.name) {
          auditRows.push(row);
          return Promise.resolve();
        }
        routeWrites.push(row);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: existingRoute?.id ?? 'route_1' }],
          }),
        };
      },
    }),
    delete: () => ({
      where: async () => {
        deleteCount += 1;
      },
    }),
  };

  return {
    integrationConnections: integrationTable,
    organizations: organizationTable,
    projects: projectTable,
    slackChannelRoutes: routeTable,
    auditLogs: auditTable,
    and: (...args: unknown[]) => ({ and: args }),
    eq: (...args: unknown[]) => ({ eq: args }),
    ne: (...args: unknown[]) => ({ ne: args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    db: {
      transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
});

import { DELETE, POST } from './route';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/integrations/slack/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validRoute = {
  organizationId: 'org_1',
  slackChannelId: 'C123',
  slackChannelName: 'triage',
  projectId: 'project_1',
  defaultLabel: 'from-slack',
  emojiTrigger: 'ticket',
  defaultPriority: 'high',
};

describe('Slack channel route mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executedLocks.length = 0;
    routeWrites.length = 0;
    auditRows.length = 0;
    connectedTeamId = 'T123';
    projectExists = true;
    existingRoute = null;
    deleteCount = 0;
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
  });

  it('upserts a route for the currently connected team and audits it atomically', async () => {
    const response = await POST(postRequest(validRoute));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      id: 'route_1',
      created: true,
      updated: false,
    });
    expect(executedLocks[0]?.values).toContain('slack-organization:org_1');
    expect(routeWrites).toEqual([
      expect.objectContaining({
        organizationId: 'org_1',
        slackTeamId: 'T123',
        slackChannelId: 'C123',
        projectId: 'project_1',
        defaultPriority: 'high',
      }),
    ]);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'organization.updated',
        resourceType: 'slack_channel_route',
        projectId: 'project_1',
        metadata: expect.objectContaining({ kind: 'slack_route_created' }),
      }),
    ]);
  });

  it('rejects a project outside the active owning workspace without writing a route', async () => {
    projectExists = false;

    const response = await POST(postRequest(validRoute));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'project_not_found' });
    expect(routeWrites).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('cannot bind a channel when Slack is disconnected', async () => {
    connectedTeamId = null;

    const response = await POST(postRequest(validRoute));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'slack_not_connected' });
    expect(routeWrites).toHaveLength(0);
  });

  it('deletes and audits under the same organization lock used by OAuth', async () => {
    existingRoute = { id: 'route_1', projectId: 'project_1' };
    const response = await DELETE(
      new NextRequest(
        'http://localhost/api/integrations/slack/routes?organizationId=org_1&id=route_1',
        { method: 'DELETE' }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: true });
    expect(executedLocks[0]?.values).toContain('slack-organization:org_1');
    expect(deleteCount).toBe(1);
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'organization.updated',
        resourceId: 'route_1',
        metadata: { kind: 'slack_route_deleted' },
      }),
    ]);
  });
});
