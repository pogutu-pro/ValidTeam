/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const mockResolveApiActor = jest.fn();
const mockCanReadProject = jest.fn();
const mockResolveProjectCapabilityAccess = jest.fn();
const dbSelectMock = jest.fn();
const inArrayMock = jest.fn((left: unknown, right: unknown) => ({
  op: 'inArray',
  left,
  right,
}));

jest.mock('@/lib/auth/api-actor', () => ({
  resolveApiActor: (...args: unknown[]) => mockResolveApiActor(...args),
  apiActorCanAccessOrganization: (
    actor: { organizationId: string | null },
    organizationId: string
  ) => actor.organizationId === null || actor.organizationId === organizationId,
}));

jest.mock('@/lib/auth/access-control', () => ({
  canReadProject: (...args: unknown[]) => mockCanReadProject(...args),
}));

jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) =>
    mockResolveProjectCapabilityAccess(...args),
}));

jest.mock('@/lib/api-validation', () => ({
  withValidation: () => (handler: unknown) => handler,
}));
jest.mock('@/lib/agent-policy/guard', () => ({
  guardAgentAction: jest.fn(),
  readAgentPolicyMarker: () => null,
  stripAgentPolicyMarker: (value: unknown) => value,
}));
jest.mock('@/lib/realtime/events', () => ({ publishEvent: jest.fn() }));
jest.mock('@/lib/notifications/send-notification', () => ({ notifyIssueEvent: jest.fn() }));
jest.mock('@/lib/automation/evaluator', () => ({ runAutomations: jest.fn() }));
jest.mock('@/lib/labels/sync', () => ({ syncIssueLabelsBestEffort: jest.fn() }));
jest.mock('@/lib/agents/triage-enqueue', () => ({ enqueueTriageOnCreate: jest.fn() }));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (value: unknown) => ({ op: 'asc', value }),
  desc: (value: unknown) => ({ op: 'desc', value }),
  eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
  inArray: (...args: unknown[]) => inArrayMock(...args),
  or: (...args: unknown[]) => ({ op: 'or', args }),
  sql: Object.assign((parts: TemplateStringsArray) => ({ op: 'sql', parts }), {
    raw: (value: string) => value,
  }),
}));

jest.mock('@tasknebula/db', () => {
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
    ROLE_DEFAULT_PERMISSIONS: {
      viewer: {},
      developer: { canCreateIssues: true, canEditIssues: true, canDeleteIssues: true },
    },
    hasPermission: () => false,
  };
});

function selectRows(rows: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    leftJoin: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return builder;
}

describe('GET /api/issues project visibility', () => {
  let GET: typeof import('./route').GET;
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ GET, POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dbSelectMock.mockReset();
    mockCanReadProject.mockReset();
    mockResolveProjectCapabilityAccess.mockReset();
    mockResolveApiActor.mockReset();
    mockResolveApiActor.mockResolvedValue({
      userId: 'user-1',
      organizationId: null,
      authType: 'session',
    });
  });

  it('rejects an organization member who cannot browse the requested private project', async () => {
    dbSelectMock.mockReturnValueOnce(
      selectRows([{ id: 'project-private', key: 'PRIVATE', organizationId: 'org-1' }])
    );
    mockCanReadProject.mockResolvedValue(false);

    const response = await GET(
      new NextRequest('http://localhost/api/issues?projectId=project-private')
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(dbSelectMock).toHaveBeenCalledTimes(1);
  });

  it('constrains an unfiltered list to explicitly readable projects', async () => {
    const readable = { id: 'project-readable', key: 'OPEN', organizationId: 'org-1' };
    const privateProject = { id: 'project-private', key: 'PRIVATE', organizationId: 'org-1' };
    dbSelectMock
      .mockReturnValueOnce(selectRows([readable, privateProject]))
      .mockReturnValueOnce(
        selectRows([{ id: 'issue-1', projectId: readable.id, organizationId: 'org-1' }])
      );
    mockCanReadProject.mockImplementation(
      async (_userId: string, project: { id: string }) => project.id === readable.id
    );

    const response = await GET(new NextRequest('http://localhost/api/issues'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issues: [{ id: 'issue-1', projectId: readable.id }],
      total: 1,
    });
    expect(inArrayMock).toHaveBeenCalledWith('issues.projectId', [readable.id]);
  });

  it('does not resolve a colliding project key outside an API key organization', async () => {
    const foreignProject = { id: 'foreign', key: 'DUP', organizationId: 'org-2' };
    const scopedProject = { id: 'scoped', key: 'DUP', organizationId: 'org-1' };
    mockResolveApiActor.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      authType: 'api_key',
    });
    dbSelectMock
      .mockReturnValueOnce(selectRows([foreignProject, scopedProject]))
      .mockReturnValueOnce(selectRows([]));
    mockCanReadProject.mockResolvedValue(true);

    const response = await GET(new NextRequest('http://localhost/api/issues?projectId=DUP'));

    expect(response.status).toBe(200);
    expect(mockCanReadProject).toHaveBeenCalledTimes(1);
    expect(mockCanReadProject).toHaveBeenCalledWith('user-1', scopedProject, {
      allowSuperAdmin: false,
    });
    expect(inArrayMock).toHaveBeenCalledWith('issues.projectId', [scopedProject.id]);
  });

  it('does not create into a colliding project key outside an API key organization', async () => {
    mockResolveApiActor.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      authType: 'api_key',
    });
    dbSelectMock.mockReturnValueOnce(
      selectRows([{ id: 'foreign', key: 'DUP', organizationId: 'org-2' }])
    );

    const response = await POST(
      new NextRequest('http://localhost/api/issues') as never,
      {
        body: {
          projectId: 'DUP',
          type: 'task',
          title: 'Must stay scoped',
          priority: 'medium',
          labels: [],
          customFields: {},
        },
        params: {},
      } as never
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Permission denied' });
    expect(mockCanReadProject).not.toHaveBeenCalled();
  });

  it('honors an explicit create denial instead of falling through to the role default', async () => {
    const project = {
      id: 'project-denied',
      key: 'DENIED',
      organizationId: 'org-1',
      defaultWorkflowId: 'workflow-1',
    };
    dbSelectMock.mockReturnValueOnce(selectRows([project]));
    mockResolveProjectCapabilityAccess.mockResolvedValue({
      project,
      canRead: true,
      permissions: {
        canCreateIssues: false,
        canEditIssues: true,
        canDeleteIssues: true,
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/issues') as never,
      {
        body: {
          projectId: project.id,
          type: 'task',
          title: 'Explicitly denied',
          priority: 'medium',
          labels: [],
          customFields: {},
        },
        params: {},
      } as never
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Insufficient permissions to create issues',
    });
  });
});
