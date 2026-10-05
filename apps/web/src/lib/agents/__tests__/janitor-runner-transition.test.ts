/** @jest-environment node */

type Row = Record<string, unknown>;

const mockSelectQueue: Row[][] = [];
const mockPrepareTransition = jest.fn();
const mockApplyTransition = jest.fn();
const mockResolveStatus = jest.fn();
const mockSweep = jest.fn();

jest.mock('@validteam/db', () => {
  const table = (name: string) =>
    new Proxy({ __name: name } as Record<string, string>, {
      get(target, property: string) {
        return target[property] ?? `${name}.${property}`;
      },
    });
  return {
    db: {
      select: () => query(mockSelectQueue.shift() ?? []),
      transaction: (callback: (tx: unknown) => unknown) =>
        callback({ select: () => query(mockSelectQueue.shift() ?? []) }),
    },
    issues: table('issues'),
    issueComments: table('issue_comments'),
    workflowStatuses: table('workflow_statuses'),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
    and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
    lte: (left: unknown, right: unknown) => ({ op: 'lte', left, right }),
    notInArray: (left: unknown, right: unknown[]) => ({ op: 'notInArray', left, right }),
  };
});

jest.mock('../janitor', () => ({
  sweepStaleIssues: (...args: unknown[]) => mockSweep(...args),
  DEFAULT_STALE_THRESHOLD_DAYS: 30,
  DEFAULT_SNOOZE_DAYS: 14,
  STALE_AUTO_LABEL: 'stale-auto',
}));

jest.mock('../credentials', () => ({
  getOrganizationSettingsForAgentCredentials: jest.fn().mockResolvedValue({}),
  resolveProviderApiKeyFromSettings: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/lib/workflows/issue-transition-policy', () => {
  class MockWorkflowTransitionError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    WorkflowTransitionError: MockWorkflowTransitionError,
    prepareIssueStatusTransition: (...args: unknown[]) => mockPrepareTransition(...args),
    applyPreparedIssueStatusTransition: (...args: unknown[]) => mockApplyTransition(...args),
    resolveProjectWorkflowStatusByCategory: (...args: unknown[]) => mockResolveStatus(...args),
  };
});

function query(rows: Row[]) {
  const chain = {
    from: (_table: unknown) => chain,
    leftJoin: (_table: unknown, _condition: unknown) => chain,
    where: (_condition: unknown) => chain,
    limit: (count: number) => Promise.resolve(rows.slice(0, count)),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

import { runJanitorForOrg } from '../janitor-runner';

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  mockResolveStatus.mockResolvedValue('status-done');
  mockPrepareTransition.mockImplementation(async (_tx, input) => ({
    issue: {
      id: input.issueId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      statusId: 'status-open',
    },
    workflowId: 'workflow-a',
    fromStatusId: 'status-open',
    toStatusId: 'status-done',
    changed: true,
    transitionId: 'transition-close',
  }));
});

it('records one policy rejection and continues closing later issues with the system actor', async () => {
  const staleRows = [
    {
      id: 'issue-a',
      key: 'TN-1',
      title: 'First',
      description: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      assigneeId: null,
      reporterId: 'reporter-a',
      priority: 'low',
      labels: [],
      statusCategory: 'backlog',
    },
    {
      id: 'issue-b',
      key: 'TN-2',
      title: 'Second',
      description: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      assigneeId: null,
      reporterId: 'reporter-b',
      priority: 'low',
      labels: [],
      statusCategory: 'backlog',
    },
  ];
  // terminal-status lookup, stale issues, then one tenant-scoped identity per
  // auto-close transaction.
  mockSelectQueue.push([], staleRows, [{ projectId: 'project-a' }], [{ projectId: 'project-a' }]);
  mockSweep.mockResolvedValue(
    staleRows.map((row) => ({
      issueId: row.id,
      action: 'auto_close_with_label',
      reason: 'stale',
      confidence: 0.9,
    }))
  );
  mockApplyTransition
    .mockRejectedValueOnce(new Error('workflow_transition_approval_required'))
    .mockResolvedValueOnce({ id: 'issue-b', statusId: 'status-done' });

  const result = await runJanitorForOrg({
    organizationId: 'org-a',
    systemUserId: 'system-janitor',
    dryRun: false,
  });

  expect(result.decisions).toEqual([
    expect.objectContaining({ issueId: 'issue-a', applied: false }),
    expect.objectContaining({ issueId: 'issue-b', applied: true }),
  ]);
  expect(mockPrepareTransition).toHaveBeenCalledTimes(2);
  expect(mockPrepareTransition).toHaveBeenNthCalledWith(
    2,
    expect.anything(),
    expect.objectContaining({
      organizationId: 'org-a',
      actorUserId: 'system-janitor',
      issueId: 'issue-b',
    })
  );
});
