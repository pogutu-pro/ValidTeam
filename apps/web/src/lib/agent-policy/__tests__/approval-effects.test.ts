/**
 * @jest-environment node
 */

type EffectRow = {
  id: string;
  approvalId: string;
  workspaceId: string;
  effectType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attemptCount: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockToken: string | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let effectRow: EffectRow;
const publishAwaitingFanOutMock = jest.fn();
const runAutomationsMock = jest.fn();

function applySet(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    if (key === 'attemptCount' && (value as { increment?: boolean }).increment) {
      effectRow.attemptCount += 1;
    } else {
      (effectRow as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

jest.mock('@tasknebula/db', () => {
  const table = new Proxy({ __name: 'agent_approval_effect_outbox' } as Record<string, string>, {
    get(target, property: string) {
      return target[property] ?? `agent_approval_effect_outbox.${property}`;
    },
  });

  const transactionExecutor = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              for: () => Promise.resolve(effectRow ? [{ id: effectRow.id }] : []),
            }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            applySet(values);
            return [{ ...effectRow }];
          },
        }),
      }),
    }),
  };

  const db = {
    transaction: <T>(callback: (tx: typeof transactionExecutor) => Promise<T>) =>
      callback(transactionExecutor),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          applySet(values);
          return [{ ...effectRow }];
        },
      }),
    }),
  };

  return { agentApprovalEffectOutbox: table, db };
});

jest.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  asc: (column: unknown) => ({ op: 'asc', column }),
  eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
  lt: (left: unknown, right: unknown) => ({ op: 'lt', left, right }),
  lte: (left: unknown, right: unknown) => ({ op: 'lte', left, right }),
  or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
  sql: () => ({ increment: true }),
}));

jest.mock('@/lib/realtime/events', () => ({
  publishEventAwaitingFanOut: (...args: unknown[]) => publishAwaitingFanOutMock(...args),
}));

jest.mock('@/lib/automation/evaluator', () => ({
  runAutomations: (...args: unknown[]) => runAutomationsMock(...args),
}));

function seedEffect(attemptCount = 0): EffectRow {
  const now = new Date('2026-08-12T10:00:00.000Z');
  return {
    id: 'effect-1',
    approvalId: 'approval-1',
    workspaceId: 'org-1',
    effectType: 'issue.updated',
    payload: {
      realtime: {
        type: 'issue.updated',
        userId: 'user-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        issueId: 'issue-1',
      },
    },
    status: 'pending',
    attemptCount,
    availableAt: now,
    lockedAt: null,
    lockToken: null,
    completedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('processApprovalEffectOutbox', () => {
  let processApprovalEffectOutbox: typeof import('../approval-effects').processApprovalEffectOutbox;

  beforeAll(async () => {
    ({ processApprovalEffectOutbox } = await import('../approval-effects'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    effectRow = seedEffect();
    runAutomationsMock.mockResolvedValue([]);
  });

  it('does not ACK the leased row until awaited Redis fan-out succeeds', async () => {
    let acceptRedis!: () => void;
    publishAwaitingFanOutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        acceptRedis = resolve;
      })
    );

    const processing = processApprovalEffectOutbox({ effectId: effectRow.id, limit: 1 });
    for (let turn = 0; turn < 5 && !publishAwaitingFanOutMock.mock.calls.length; turn += 1) {
      await Promise.resolve();
    }

    expect(publishAwaitingFanOutMock).toHaveBeenCalledTimes(1);
    expect(effectRow.status).toBe('processing');
    expect(effectRow.completedAt).toBeNull();

    acceptRedis();
    await expect(processing).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      failed: 0,
    });
    expect(effectRow.status).toBe('completed');
    expect(effectRow.completedAt).toBeInstanceOf(Date);
  });

  it('releases the row for retry when Redis fan-out rejects', async () => {
    publishAwaitingFanOutMock.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      processApprovalEffectOutbox({ effectId: effectRow.id, limit: 1 })
    ).resolves.toEqual({ claimed: 1, completed: 0, retried: 1, failed: 0 });

    expect(effectRow.status).toBe('pending');
    expect(effectRow.attemptCount).toBe(1);
    expect(effectRow.lockedAt).toBeNull();
    expect(effectRow.lockToken).toBeNull();
    expect(effectRow.completedAt).toBeNull();
    expect(effectRow.lastError).toBe('redis unavailable');
    expect(runAutomationsMock).not.toHaveBeenCalled();
  });

  it('marks the row failed after the final Redis delivery attempt', async () => {
    effectRow = seedEffect(7);
    publishAwaitingFanOutMock.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      processApprovalEffectOutbox({ effectId: effectRow.id, limit: 1 })
    ).resolves.toEqual({ claimed: 1, completed: 0, retried: 0, failed: 1 });

    expect(effectRow.status).toBe('failed');
    expect(effectRow.attemptCount).toBe(8);
    expect(effectRow.completedAt).toBeNull();
  });
});
