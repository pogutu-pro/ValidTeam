/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const dbSelectMock = jest.fn();
const resolveProjectCapabilityAccessMock = jest.fn();
const resolveOrganizationAccessMock = jest.fn();

jest.mock('@/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

jest.mock('@/lib/agent-policy/guard', () => ({
  guardAgentAction: jest.fn(),
  readAgentPolicyMarker: () => null,
  stripAgentPolicyMarker: (value: Record<string, unknown>) => value,
}));

jest.mock('@/lib/realtime/events', () => ({ publishEvent: jest.fn() }));
jest.mock('@/lib/notifications/send-notification', () => ({ notifyIssueEvent: jest.fn() }));
jest.mock('@/lib/automation/evaluator', () => ({ runAutomations: jest.fn() }));
jest.mock('@/lib/labels/sync', () => ({ syncIssueLabelsBestEffort: jest.fn() }));
jest.mock('@/lib/agents/triage-enqueue', () => ({ enqueueTriageOnCreate: jest.fn() }));

jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) =>
    resolveProjectCapabilityAccessMock(...args),
}));

jest.mock('@/lib/auth/access-control', () => ({
  canReadProject: jest.fn().mockResolvedValue(true),
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccessMock(...args),
}));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (value: unknown) => ({ op: 'asc', value }),
  desc: (value: unknown) => ({ op: 'desc', value }),
  eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
  inArray: (left: unknown, right: unknown) => ({ op: 'inArray', left, right }),
  or: (...args: unknown[]) => ({ op: 'or', args }),
  sql: Object.assign((parts: TemplateStringsArray) => ({ op: 'sql', parts }), {
    raw: (value: string) => value,
  }),
}));

jest.mock('@validteam/db', () => {
  const table = (name: string) =>
    new Proxy(
      { __name: name },
      {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target];
          return `${name}.${String(property)}`;
        },
      }
    );

  return {
    db: {
      select: (...args: unknown[]) => dbSelectMock(...args),
      transaction: jest.fn(),
    },
    projects: table('projects'),
    issues: table('issues'),
    workflowStatuses: table('workflow_statuses'),
    workflows: table('workflows'),
    sprints: table('sprints'),
    users: table('users'),
    projectMembers: table('project_members'),
    organizationMembers: table('organization_members'),
    getIssues: jest.fn(),
    createIssue: jest.fn(),
    createActivity: jest.fn(),
    createAuditLog: jest.fn(),
    ROLE_DEFAULT_PERMISSIONS: { viewer: {} },
    hasPermission: () => false,
  };
});

function chainable<T>(result: T) {
  const chain: {
    from: () => typeof chain;
    where: () => typeof chain;
    limit: () => Promise<T>;
    orderBy: () => Promise<T>;
    then: (resolve: (value: T) => unknown) => Promise<unknown>;
  } = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
    orderBy: () => Promise.resolve(result),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function createRequest(overrides: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'project_1',
      type: 'task',
      title: 'Scoped child issue',
      ...overrides,
    }),
  });
}

describe('POST /api/issues relationship integrity', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    resolveProjectCapabilityAccessMock.mockResolvedValue({
      project: { id: 'project_1', organizationId: 'org_1' },
      canRead: true,
      canManage: true,
      permissions: { canCreateIssues: true },
    });
    resolveOrganizationAccessMock.mockResolvedValue({
      allowed: true,
      isSuperAdmin: false,
      role: 'member',
      membershipId: 'member_1',
    });
  });

  it('rejects a parent from another project before insertion', async () => {
    dbSelectMock
      .mockReturnValueOnce(
        chainable([
          {
            id: 'project_1',
            organizationId: 'org_1',
            defaultWorkflowId: 'workflow_1',
          },
        ])
      )
      .mockReturnValueOnce(
        chainable([{ id: 'issue_2', projectId: 'project_2', organizationId: 'org_1' }])
      );

    const response = await POST(createRequest({ parentId: 'issue_2' }) as never, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Parent issue must belong to the same project',
    });
  });

  it('rejects a supplied status from another workflow instead of silently defaulting', async () => {
    dbSelectMock
      .mockReturnValueOnce(
        chainable([
          {
            id: 'project_1',
            organizationId: 'org_1',
            defaultWorkflowId: 'workflow_1',
          },
        ])
      )
      .mockReturnValueOnce(
        chainable([
          { id: 'status_backlog', workflowId: 'workflow_1', category: 'backlog', position: 0 },
        ])
      );

    const response = await POST(createRequest({ statusId: 'status_foreign' }) as never, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Status does not belong to the project workflow',
    });
  });

  it('rejects a sprint from another project', async () => {
    dbSelectMock
      .mockReturnValueOnce(
        chainable([
          {
            id: 'project_1',
            organizationId: 'org_1',
            defaultWorkflowId: 'workflow_1',
          },
        ])
      )
      .mockReturnValueOnce(chainable([]));

    const response = await POST(createRequest({ sprintId: 'sprint_foreign' }) as never, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_sprint' });
  });

  it('rejects a non-epic or cross-project epic relation', async () => {
    dbSelectMock
      .mockReturnValueOnce(
        chainable([
          {
            id: 'project_1',
            organizationId: 'org_1',
            defaultWorkflowId: 'workflow_1',
          },
        ])
      )
      .mockReturnValueOnce(
        chainable([
          {
            id: 'issue_2',
            projectId: 'project_1',
            organizationId: 'org_1',
            type: 'task',
          },
        ])
      );

    const response = await POST(createRequest({ epicId: 'issue_2' }) as never, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_epic' });
  });

  it('rejects an assignee outside the active workspace membership', async () => {
    dbSelectMock.mockReturnValueOnce(
      chainable([
        {
          id: 'project_1',
          organizationId: 'org_1',
          defaultWorkflowId: 'workflow_1',
        },
      ])
    );
    resolveOrganizationAccessMock.mockResolvedValueOnce({
      allowed: false,
      isSuperAdmin: false,
      role: null,
      membershipId: null,
    });

    const response = await POST(createRequest({ assigneeId: 'user_foreign' }) as never, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_assignee' });
  });
});
