/**
 * @jest-environment node
 */

type Row = Record<string, unknown>;

const mockSelectQueue: Row[][] = [];
const mockInserted: Array<{ table: string; values: Row }> = [];
const mockUpdated: Array<{ table: string; values: Row }> = [];
let mockUpdateResult: Row[] = [];

jest.mock('@tasknebula/db', () => {
  const table = (name: string) =>
    new Proxy({ __name: name } as Record<string, string>, {
      get(target, property: string) {
        return target[property] ?? `${name}.${property}`;
      },
    });

  return {
    auditLogs: table('audit_logs'),
    db: { transaction: jest.fn() },
    eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
    issueActivities: table('issue_activities'),
    issueComments: table('issue_comments'),
    issues: table('issues'),
    organizationMembers: table('organization_members'),
    organizations: table('organizations'),
    projectMembers: table('project_members'),
    projects: table('projects'),
    sprints: table('sprints'),
    workflowStatuses: table('workflow_statuses'),
    workflows: table('workflows'),
    users: table('users'),
  };
});

jest.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (column: unknown) => ({ op: 'desc', column }),
  ne: (left: unknown, right: unknown) => ({ op: 'ne', left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const syncLabelsMock = jest.fn();
jest.mock('@/lib/labels/sync', () => ({
  syncIssueLabelsWithExecutor: (...args: unknown[]) => syncLabelsMock(...args),
}));

const mockPrepareTransition = jest.fn(async (..._args: unknown[]) => ({
  issue: issueRow(),
  workflowId: 'workflow-a',
  fromStatusId: 'status-backlog',
  toStatusId: 'status-review',
  changed: true,
  transitionId: 'transition-a',
}));
const mockApplyTransition = jest.fn(async () => mockUpdateResult[0]);
jest.mock('@/lib/workflows/issue-transition-policy', () => ({
  prepareIssueStatusTransition: (...args: unknown[]) => mockPrepareTransition(...args),
  applyPreparedIssueStatusTransition: (...args: unknown[]) => mockApplyTransition(...args),
}));

import type { AgentApprovalRequest } from '@tasknebula/db';
import { executeApprovedAgentAction } from '../executors';

function queryChain(rows: Row[]) {
  const chain = {
    from: (_table: unknown) => chain,
    innerJoin: (_table: unknown, _condition: unknown) => chain,
    where: (_condition: unknown) => chain,
    orderBy: (..._args: unknown[]) => chain,
    limit: (count: number) => Promise.resolve(rows.slice(0, count)),
    then: (resolve: (value: Row[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

const mockTx = {
  select: (_selection?: unknown) => queryChain(mockSelectQueue.shift() ?? []),
  execute: jest.fn().mockResolvedValue(undefined),
  insert: (table: { __name: string }) => ({
    values: (values: Row) => {
      mockInserted.push({ table: table.__name, values });
      const inserted =
        table.__name === 'issues'
          ? [{ ...values }]
          : table.__name === 'issue_comments'
            ? [{ ...values }]
            : [];
      const operation = {
        returning: () => Promise.resolve(inserted),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };
      return operation;
    },
  }),
  update: (table: { __name: string }) => ({
    set: (values: Row) => {
      mockUpdated.push({ table: table.__name, values });
      return {
        where: (_condition: unknown) => ({
          returning: () => Promise.resolve(mockUpdateResult),
        }),
      };
    },
  }),
};

function approval(overrides: Partial<AgentApprovalRequest> = {}): AgentApprovalRequest {
  return {
    id: 'approval-1',
    workspaceId: 'org-1',
    projectId: 'project-a',
    requestedBy: 'user-1',
    actor: 'agent:codex',
    resource: 'comments',
    action: 'create',
    targetType: 'issue',
    targetId: 'issue-b',
    proposedPayload: {
      executor: 'comments:create',
      data: { issueId: 'issue-b', data: { content: 'Looks good' } },
    },
    matchedRule: null,
    decisionReason: 'require_approval',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    requestedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgentApprovalRequest;
}

function projectRow(): Row {
  return {
    id: 'project-a',
    organizationId: 'org-1',
    key: 'TNA',
    defaultWorkflowId: 'workflow-a',
  };
}

function issueRow(): Row {
  return {
    id: 'issue-a',
    organizationId: 'org-1',
    projectId: 'project-a',
    reporterId: 'user-2',
    sprintId: null,
    statusId: 'status-backlog',
    labels: [],
  };
}

describe('executeApprovedAgentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockInserted.length = 0;
    mockUpdated.length = 0;
    mockUpdateResult = [];
    syncLabelsMock.mockResolvedValue([]);
  });

  it('does not apply a project-scoped comment approval to an issue in another project', async () => {
    mockSelectQueue.push([{ ...issueRow(), projectId: 'project-b' }]);

    await expect(executeApprovedAgentAction(approval(), mockTx as never)).rejects.toThrow(
      'issue_not_found'
    );
    expect(mockInserted).toHaveLength(0);
  });

  it('does not execute an issue payload different from the policy-approved target', async () => {
    const request = approval({
      targetId: 'issue-a',
      proposedPayload: {
        executor: 'comments:create',
        data: { issueId: 'issue-b', data: { content: 'Different target' } },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'issue_not_found'
    );
    expect(mockSelectQueue).toHaveLength(0);
    expect(mockInserted).toHaveLength(0);
  });

  it('rejects a create parent that is not in the approval workspace and project', async () => {
    mockSelectQueue.push([projectRow()], []);
    const request = approval({
      resource: 'issues',
      action: 'create',
      proposedPayload: {
        executor: 'issues:create',
        data: {
          projectId: 'project-a',
          type: 'task',
          title: 'Child task',
          parentId: 'issue-other-project',
        },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'parent_issue_not_found'
    );
    expect(mockInserted.find((row) => row.table === 'issues')).toBeUndefined();
  });

  it('rejects create relationships outside the project or workspace', async () => {
    mockSelectQueue.push([projectRow()], []);
    const request = approval({
      resource: 'issues',
      action: 'create',
      proposedPayload: {
        executor: 'issues:create',
        data: {
          projectId: 'project-a',
          type: 'task',
          title: 'Scoped relationships',
          sprintId: 'sprint-from-project-b',
        },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'sprint_not_found'
    );
    expect(mockInserted.find((row) => row.table === 'issues')).toBeUndefined();
  });

  it('requires an assignee to be active in both workspace and project', async () => {
    mockSelectQueue.push([projectRow()], [{ id: 'org-member-1' }], []);
    const request = approval({
      resource: 'issues',
      action: 'create',
      proposedPayload: {
        executor: 'issues:create',
        data: {
          projectId: 'project-a',
          type: 'task',
          title: 'Scoped assignee',
          assigneeId: 'member-from-another-project',
        },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'assignee_not_found'
    );
  });

  it('fails an invalid supplied create status instead of falling back to backlog', async () => {
    mockSelectQueue.push(
      [projectRow()],
      [{ id: 'status-backlog', workflowId: 'workflow-a', category: 'backlog', position: 0 }]
    );
    const request = approval({
      resource: 'issues',
      action: 'create',
      proposedPayload: {
        executor: 'issues:create',
        data: {
          projectId: 'project-a',
          type: 'task',
          title: 'Status must be explicit',
          statusId: 'status-from-another-workflow',
        },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'status_not_found'
    );
    expect(mockInserted.find((row) => row.table === 'issues')).toBeUndefined();
  });

  it('rejects an update status outside the project selected/default workflow', async () => {
    mockSelectQueue.push([issueRow()], [projectRow()], []);
    const request = approval({
      resource: 'issues',
      action: 'update',
      targetId: 'issue-a',
      proposedPayload: {
        executor: 'issues:update',
        data: { issueId: 'issue-a', data: { statusId: 'status-from-another-workflow' } },
      },
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'status_not_found'
    );
    expect(mockUpdated).toHaveLength(0);
  });

  it('rejects a comment parent that belongs to another issue', async () => {
    mockSelectQueue.push([issueRow()], []);
    const request = approval({
      proposedPayload: {
        executor: 'comments:create',
        data: {
          issueId: 'issue-a',
          data: { content: 'Nested reply', parentId: 'comment-from-another-issue' },
        },
      },
      targetId: 'issue-a',
    });

    await expect(executeApprovedAgentAction(request, mockTx as never)).rejects.toThrow(
      'parent_comment_not_found'
    );
    expect(mockInserted.find((row) => row.table === 'issue_comments')).toBeUndefined();
  });

  it('accepts an update status that belongs to the project selected workflow', async () => {
    const current = issueRow();
    const updated = { ...current, statusId: 'status-review' };
    mockSelectQueue.push([current], [projectRow()], [{ id: 'status-review' }]);
    mockUpdateResult = [updated];
    const request = approval({
      resource: 'issues',
      action: 'update',
      targetId: 'issue-a',
      proposedPayload: {
        executor: 'issues:update',
        data: { issueId: 'issue-a', data: { statusId: 'status-review' } },
      },
    });

    const execution = await executeApprovedAgentAction(request, mockTx as never);

    expect(execution.result).toMatchObject({ id: 'issue-a', statusId: 'status-review' });
    expect(mockPrepareTransition).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'project-a',
        issueId: 'issue-a',
        toStatusId: 'status-review',
      })
    );
    expect(mockApplyTransition).toHaveBeenCalledTimes(1);
    expect(execution.postCommit.realtime.type).toBe('issue.updated');
  });
});
