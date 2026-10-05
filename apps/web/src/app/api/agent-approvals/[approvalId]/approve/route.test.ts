/**
 * @jest-environment node
 */

const authMock = jest.fn();
const canManageMock = jest.fn();
const evaluatePolicyMock = jest.fn();
const executeMock = jest.fn();
const processEffectsMock = jest.fn();
const requesterAccessMock = jest.fn();
const canEditIssueMock = jest.fn();
const canCommentOnIssueMock = jest.fn();
const dbUpdateMock = jest.fn();
const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
const afterCallbacks: Array<() => Promise<void> | void> = [];

class MockNextResponse {
  constructor(
    private readonly payload: unknown,
    init?: { status?: number }
  ) {
    this.status = init?.status ?? 200;
  }

  status: number;

  async json() {
    return this.payload;
  }

  static json(payload: unknown, init?: { status?: number }) {
    return new MockNextResponse(payload, init);
  }
}

jest.mock('next/server', () => ({
  NextResponse: MockNextResponse,
  after: (callback: () => Promise<void> | void) => afterCallbacks.push(callback),
}));
jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/agent-policy/approval-permissions', () => ({
  canManageAgentApprovals: (...args: unknown[]) => canManageMock(...args),
}));
jest.mock('@/lib/agent-policy/evaluator', () => ({
  evaluateAgentPolicy: (...args: unknown[]) => evaluatePolicyMock(...args),
}));
jest.mock('@/lib/agent-policy/executors', () => ({
  executeApprovedAgentAction: (...args: unknown[]) => executeMock(...args),
}));
jest.mock('@/lib/agent-policy/approval-effects', () => ({
  processApprovalEffectOutbox: (...args: unknown[]) => processEffectsMock(...args),
}));
jest.mock('@/lib/logger', () => ({
  childLogger: () => ({ error: jest.fn() }),
}));
jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) => requesterAccessMock(...args),
}));
jest.mock('@/lib/auth/access-control', () => ({
  canEditIssue: (...args: unknown[]) => canEditIssueMock(...args),
  canCommentOnIssue: (...args: unknown[]) => canCommentOnIssueMock(...args),
}));

const approvalTable = {
  id: 'id',
  status: 'status',
  expiresAt: 'expiresAt',
  decidedBy: 'decidedBy',
};
const effectTable = { __name: 'agent_approval_effect_outbox', id: 'effect.id' };
const auditTable = { __name: 'audit_logs' };

function updateBuilder() {
  return {
    set: (values: { status?: string }) => ({
      where: () => {
        let rows: Array<typeof currentApproval> = [];
        if (values.status === 'executing') {
          if (claimAvailable && currentApproval.status === 'pending') {
            claimAvailable = false;
            currentApproval = { ...currentApproval, ...values };
            rows = [{ ...currentApproval }];
          }
        } else if (values.status === 'approved') {
          if (currentApproval.status === 'executing') {
            currentApproval = { ...currentApproval, ...values };
            rows = [{ ...currentApproval }];
          }
        } else {
          currentApproval = { ...currentApproval, ...values };
          rows = [{ ...currentApproval }];
        }

        const operation = Promise.resolve(rows) as Promise<typeof rows> & {
          returning: () => Promise<typeof rows>;
        };
        operation.returning = () => Promise.resolve(rows);
        return operation;
      },
    }),
  };
}

const database = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ ...currentApproval }]),
      }),
    }),
  }),
  update: (...args: unknown[]) => dbUpdateMock(...args),
  insert: (table: { __name: string }) => ({
    values: (values: Record<string, unknown>) => {
      inserted.push({ table: table.__name, values });
      const operation = {
        onConflictDoNothing: () => operation,
        returning: (_selection?: unknown) => Promise.resolve([{ id: 'effect-1' }]),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };
      return operation;
    },
  }),
  async transaction<T>(callback: (tx: typeof database) => Promise<T>): Promise<T> {
    const snapshot = {
      currentApproval: { ...currentApproval },
      claimAvailable,
      insertedLength: inserted.length,
    };
    try {
      return await callback(database);
    } catch (error) {
      currentApproval = snapshot.currentApproval;
      claimAvailable = snapshot.claimAvailable;
      inserted.length = snapshot.insertedLength;
      throw error;
    }
  },
};

jest.mock('@validteam/db', () => ({
  agentApprovalRequests: approvalTable,
  agentApprovalEffectOutbox: effectTable,
  auditLogs: auditTable,
  db: database,
}));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (...args: unknown[]) => ({ type: 'eq', args }),
  gt: (...args: unknown[]) => ({ type: 'gt', args }),
  isNull: (...args: unknown[]) => ({ type: 'isNull', args }),
  or: (...args: unknown[]) => ({ type: 'or', args }),
}));

const baseApproval = {
  id: 'approval-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  requestedBy: 'requester-1',
  actor: 'codex',
  resource: 'issues',
  action: 'update',
  targetType: 'issue',
  targetId: 'issue-1',
  proposedPayload: { executor: 'issues:update', data: { issueId: 'issue-1', data: {} } },
  matchedRule: 'agent codex issues update require_approval',
  decisionReason: 'approval required',
  status: 'pending',
  expiresAt: null as Date | null,
};

let currentApproval = { ...baseApproval };
let claimAvailable = true;

function installUpdateBehavior() {
  dbUpdateMock.mockImplementation(updateBuilder);
}

describe('POST /api/agent-approvals/:approvalId/approve', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentApproval = { ...baseApproval };
    claimAvailable = true;
    inserted.length = 0;
    afterCallbacks.length = 0;
    authMock.mockResolvedValue({ user: { id: 'approver-1' } });
    canManageMock.mockResolvedValue(true);
    requesterAccessMock.mockResolvedValue({
      canRead: true,
      canManage: false,
      project: { id: 'project-1', organizationId: 'workspace-1' },
      permissions: { canCreateIssues: true, canEditIssues: true, canAddComments: true },
    });
    canEditIssueMock.mockResolvedValue({ allowed: true, issue: { id: 'issue-1' } });
    canCommentOnIssueMock.mockResolvedValue({ allowed: true, issue: { id: 'issue-1' } });
    evaluatePolicyMock.mockResolvedValue({ decision: 'require_approval' });
    executeMock.mockResolvedValue({
      result: { id: 'issue-1' },
      postCommit: {
        realtime: {
          type: 'issue.updated',
          userId: 'requester-1',
          organizationId: 'workspace-1',
          projectId: 'project-1',
          issueId: 'issue-1',
        },
      },
    });
    processEffectsMock.mockResolvedValue({ claimed: 1, completed: 1, retried: 0, failed: 0 });
    installUpdateBehavior();
  });

  it('atomically claims a pending approval so concurrent requests execute once', async () => {
    const params = { params: Promise.resolve({ approvalId: currentApproval.id }) };
    const [first, second] = await Promise.all([
      POST(new Request('http://localhost'), params),
      POST(new Request('http://localhost'), params),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(inserted.filter((row) => row.table === 'audit_logs')).toHaveLength(1);
    expect(inserted.filter((row) => row.table === 'agent_approval_effect_outbox')).toHaveLength(1);
    expect(afterCallbacks).toHaveLength(1);
  });

  it('does not execute an expired approval', async () => {
    currentApproval = { ...baseApproval, expiresAt: new Date(Date.now() - 1_000) };

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ approvalId: currentApproval.id }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'approval_expired' });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('revalidates policy and fails closed when the action is now denied', async () => {
    evaluatePolicyMock.mockResolvedValue({ decision: 'deny' });

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ approvalId: currentApproval.id }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'approval_policy_changed' });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('expires an approval when the requester lost project access before execution', async () => {
    requesterAccessMock.mockResolvedValue({
      canRead: false,
      canManage: false,
      project: { id: 'project-1', organizationId: 'workspace-1' },
      permissions: { canCreateIssues: false, canEditIssues: false, canAddComments: false },
    });

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ approvalId: currentApproval.id }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'approval_requester_access_changed' });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('records a terminal failed state instead of making an ambiguous retry', async () => {
    executeMock.mockRejectedValue(new Error('effect failed'));

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ approvalId: currentApproval.id }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'approval_execution_failed' });
    expect(dbUpdateMock).toHaveBeenCalledTimes(2);
    expect(currentApproval.status).toBe('failed');
    expect(inserted).toHaveLength(0);
  });
});
