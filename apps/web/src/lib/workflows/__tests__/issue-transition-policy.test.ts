/** @jest-environment node */

type Row = Record<string, unknown>;

const mockSelectQueue: Row[][] = [];
const mockUpdateQueue: Row[][] = [];
const mockSelectFrom: string[] = [];
const mockUpdates: Array<{ table: string; values: Row }> = [];
const mockInserts: Array<{ table: string; values: Row }> = [];

jest.mock('@tasknebula/db', () => {
  const table = (name: string) =>
    new Proxy({ __name: name } as Record<string, string>, {
      get(target, property: string) {
        return target[property] ?? `${name}.${property}`;
      },
    });

  return {
    db: { transaction: jest.fn() },
    issues: table('issues'),
    issueStatusHistory: table('issue_status_history'),
    organizationMembers: table('organization_members'),
    organizations: table('organizations'),
    projectMembers: table('project_members'),
    projects: table('projects'),
    users: table('users'),
    workflows: table('workflows'),
    workflowStatuses: table('workflow_statuses'),
    workflowTransitions: table('workflow_transitions'),
    ROLE_DEFAULT_PERMISSIONS: {
      developer: { canTransitionIssues: true },
      viewer: { canTransitionIssues: false },
    },
  };
});

jest.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
  inArray: (left: unknown, right: unknown[]) => ({ op: 'inArray', left, right }),
}));

import {
  applyBulkIssueStatusTransitions,
  applyPreparedIssueStatusTransition,
  prepareIssueStatusTransition,
  WorkflowTransitionError,
  type PreparedIssueStatusTransition,
} from '../issue-transition-policy';

function queryChain(rows: Row[]) {
  let selected = rows;
  const chain = {
    from: (table: { __name: string }) => {
      mockSelectFrom.push(table.__name);
      return chain;
    },
    innerJoin: (_table: unknown, _condition: unknown) => chain,
    where: (_condition: unknown) => chain,
    orderBy: (..._columns: unknown[]) => chain,
    limit: (count: number) => {
      selected = selected.slice(0, count);
      return chain;
    },
    for: (..._args: unknown[]) => Promise.resolve(selected),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(selected).then(resolve, reject),
  };
  return chain;
}

const mockTx = {
  select: (_selection?: unknown) => queryChain(mockSelectQueue.shift() ?? []),
  update: (table: { __name: string }) => ({
    set: (values: Row) => {
      mockUpdates.push({ table: table.__name, values });
      return {
        where: (_condition: unknown) => ({
          returning: () => Promise.resolve(mockUpdateQueue.shift() ?? []),
        }),
      };
    },
  }),
  insert: (table: { __name: string }) => ({
    values: (values: Row) => {
      mockInserts.push({ table: table.__name, values });
      return Promise.resolve();
    },
  }),
};

function issue(id = 'issue-a', statusId = 'status-a'): Row {
  return {
    id,
    organizationId: 'org-a',
    projectId: 'project-a',
    statusId,
    reporterId: 'user-a',
    labels: [],
  };
}

function project(defaultWorkflowId: string | null = 'workflow-a'): Row {
  return {
    id: 'project-a',
    organizationId: 'org-a',
    defaultWorkflowId,
  };
}

function transition(overrides: Row = {}): Row {
  return {
    id: 'transition-a-b',
    workflowId: 'workflow-a',
    fromStatusId: 'status-a',
    toStatusId: 'status-b',
    allowedRoles: ['admin', 'member'],
    requiresApproval: false,
    approverRoles: ['admin'],
    approvedTargetStatusId: null,
    rejectedTargetStatusId: null,
    conditions: [],
    validators: [],
    postActions: [],
    ...overrides,
  };
}

function queuePolicy(
  overrides: {
    issue?: Row;
    project?: Row;
    organizationStatus?: string;
    transition?: Row | null;
    statusRows?: Row[];
    actor?: Row;
    membership?: Row | null;
    projectMembership?: Row | null;
    approvalTargets?: Row[];
  } = {}
) {
  const issueRow = overrides.issue ?? issue();
  const projectRow = overrides.project ?? project();
  mockSelectQueue.push(
    [
      {
        issue: issueRow,
        project: projectRow,
        organizationStatus: overrides.organizationStatus ?? 'active',
      },
    ],
    [{ id: 'workflow-a' }],
    overrides.statusRows ?? [{ id: 'status-a' }, { id: 'status-b' }],
    overrides.transition === null ? [] : [overrides.transition ?? transition()],
    [overrides.actor ?? { isSuperAdmin: false, status: 'active' }]
  );
  if (!(overrides.actor?.isSuperAdmin ?? false)) {
    mockSelectQueue.push(
      overrides.membership === null ? [] : [overrides.membership ?? { role: 'member' }]
    );
    if (
      (overrides.membership?.role ?? 'member') !== 'owner' &&
      (overrides.membership?.role ?? 'member') !== 'admin'
    ) {
      mockSelectQueue.push(
        overrides.projectMembership === null
          ? []
          : [
              overrides.projectMembership ?? {
                role: 'developer',
                canTransitionIssues: 'true',
              },
            ]
      );
    }
  }
  if ((overrides.transition?.requiresApproval ?? false) && overrides.approvalTargets) {
    mockSelectQueue.push(overrides.approvalTargets);
  }
}

const baseInput = {
  organizationId: 'org-a',
  projectId: 'project-a',
  issueId: 'issue-a',
  toStatusId: 'status-b',
  actorUserId: 'user-a',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  mockUpdateQueue.length = 0;
  mockSelectFrom.length = 0;
  mockUpdates.length = 0;
  mockInserts.length = 0;
});

describe('prepareIssueStatusTransition', () => {
  it('rejects a cross-organization issue lookup without revealing it', async () => {
    mockSelectQueue.push([]);

    await expect(
      prepareIssueStatusTransition(mockTx as never, {
        ...baseInput,
        organizationId: 'org-other',
      })
    ).rejects.toMatchObject({ code: 'workflow_transition_issue_not_found', httpStatus: 404 });
  });

  it('rejects a target status from another organization/workflow', async () => {
    queuePolicy({ statusRows: [{ id: 'status-a' }] });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_status_invalid',
    });
  });

  it('rejects every transition while the workspace is suspended', async () => {
    queuePolicy({ organizationStatus: 'suspended' });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_issue_not_found',
    });
  });

  it('rejects an inactive transition actor even when membership remains active', async () => {
    queuePolicy({ actor: { id: 'user-a', isSuperAdmin: false, status: 'inactive' } });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_actor_forbidden',
    });
  });

  it('requires an exact persisted from-to edge', async () => {
    queuePolicy({ transition: null });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_not_allowed',
    });
  });

  it('fails closed when the exact from-to edge is duplicated', async () => {
    const issueRow = issue();
    mockSelectQueue.push(
      [{ issue: issueRow, project: project(), organizationStatus: 'active' }],
      [{ id: 'workflow-a' }],
      [{ id: 'status-a' }, { id: 'status-b' }],
      [transition(), transition({ id: 'transition-a-b-duplicate', allowedRoles: ['guest'] })]
    );

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_policy_invalid',
      httpStatus: 422,
    });
  });

  it('maps active organization membership into the persisted allowed roles', async () => {
    queuePolicy({
      transition: transition({ allowedRoles: ['admin'] }),
      membership: { role: 'member' },
    });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_actor_forbidden',
    });
  });

  it('requires project-level canTransitionIssues for a human actor', async () => {
    queuePolicy({
      projectMembership: { role: 'developer', canTransitionIssues: 'false' },
    });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_actor_forbidden',
      httpStatus: 403,
    });
  });

  it('allows a trusted system actor without project membership but still applies admin policy', async () => {
    mockSelectQueue.push(
      [{ issue: issue(), project: project(), organizationStatus: 'active' }],
      [{ id: 'workflow-a' }],
      [{ id: 'status-a' }, { id: 'status-b' }],
      [transition({ allowedRoles: ['admin'] })],
      [{ id: 'system-janitor', isSuperAdmin: false, status: 'active' }]
    );

    await expect(
      prepareIssueStatusTransition(mockTx as never, {
        ...baseInput,
        actorUserId: 'system-janitor',
        actorKind: 'system',
      })
    ).resolves.toMatchObject({ transitionId: 'transition-a-b' });
  });

  it('fails closed with a typed code when workflow approval is required', async () => {
    queuePolicy({
      transition: transition({
        requiresApproval: true,
        approvedTargetStatusId: 'status-b',
        rejectedTargetStatusId: 'status-a',
      }),
      approvalTargets: [{ id: 'status-a' }, { id: 'status-b' }],
    });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_approval_required',
      httpStatus: 409,
    });
  });

  it('rejects approval targets that are outside the selected workflow', async () => {
    queuePolicy({
      transition: transition({
        requiresApproval: true,
        approvedTargetStatusId: 'status-from-other-workflow',
        rejectedTargetStatusId: 'status-a',
      }),
      approvalTargets: [{ id: 'status-a' }],
    });

    await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
      code: 'workflow_transition_policy_invalid',
      httpStatus: 422,
    });
  });

  it.each(['conditions', 'validators', 'postActions'] as const)(
    'fails closed when persisted %s contain an unsupported rule',
    async (field) => {
      queuePolicy({ transition: transition({ [field]: [{ type: 'future-rule' }] }) });

      await expect(prepareIssueStatusTransition(mockTx as never, baseInput)).rejects.toMatchObject({
        code: 'workflow_transition_policy_unsupported',
      });
    }
  );

  it('derives the workflow from the current status when a project has no selected workflow', async () => {
    queuePolicy({ project: project(null) });

    const prepared = await prepareIssueStatusTransition(mockTx as never, baseInput);

    expect(prepared.workflowId).toBe('workflow-a');
    // Context is selected from issues; the next query starts at statuses and
    // joins workflows, rather than picking an ambiguous org default.
    expect(mockSelectFrom.slice(0, 2)).toEqual(['issues', 'workflow_statuses']);
  });
});

describe('atomic application', () => {
  it('uses status CAS so concurrent A→B and A→C cannot both win', async () => {
    const preparedB: PreparedIssueStatusTransition = {
      issue: issue() as never,
      workflowId: 'workflow-a',
      fromStatusId: 'status-a',
      toStatusId: 'status-b',
      changed: true,
      transitionId: 'transition-a-b',
    };
    const preparedC = { ...preparedB, toStatusId: 'status-c', transitionId: 'transition-a-c' };
    mockUpdateQueue.push([{ ...issue(), statusId: 'status-b' }], []);

    const results = await Promise.allSettled([
      applyPreparedIssueStatusTransition(mockTx as never, {
        prepared: preparedB,
        actorUserId: 'user-a',
        reason: 'test',
      }),
      applyPreparedIssueStatusTransition(mockTx as never, {
        prepared: preparedC,
        actorUserId: 'user-a',
        reason: 'test',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'workflow_transition_conflict', httpStatus: 409 },
    });

    expect(mockInserts.filter((entry) => entry.table === 'issue_status_history')).toHaveLength(1);
  });

  it('prepares every bulk member before applying any mutation', async () => {
    queuePolicy();
    // The second issue is inaccessible/foreign. It fails during phase one.
    mockSelectQueue.push([]);

    await expect(
      applyBulkIssueStatusTransitions(mockTx as never, {
        issues: [
          { organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-a' },
          { organizationId: 'org-a', projectId: 'project-a', issueId: 'issue-b' },
        ],
        toStatusId: 'status-b',
        actorUserId: 'user-a',
        reason: 'user_bulk',
      })
    ).rejects.toBeInstanceOf(WorkflowTransitionError);

    expect(mockUpdates).toHaveLength(0);
    expect(mockInserts).toHaveLength(0);
  });
});
