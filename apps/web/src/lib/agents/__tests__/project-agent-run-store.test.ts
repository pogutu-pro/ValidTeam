/** @jest-environment node */

jest.mock('@validteam/db', () => ({
  agentRuns: {},
  agentRunStepEvents: {},
  auditLogs: {},
  db: { select: jest.fn() },
  notifications: {},
  organizations: {},
  users: {},
}));
import {
  classifyProjectAgentGuardMiss,
  getLocalizedRunFailureCopy,
  getProjectAgentDeadline,
  getUtcAgentQuotaDayStart,
  hashProjectAgentIngressRequest,
  hashProjectAgentRequest,
  isProjectAgentLeaseLost,
  ProjectAgentLeaseLost,
  serializeProjectAgentRun,
  serializeProjectAgentRunEnvelope,
} from '../project-agent-run-store';

describe('project agent run store invariants', () => {
  it('hashes semantically identical request objects identically', () => {
    expect(hashProjectAgentRequest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashProjectAgentRequest({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it('uses a replica-independent UTC quota boundary', () => {
    expect(getUtcAgentQuotaDayStart(new Date('2026-08-12T23:59:59.999-07:00')).toISOString()).toBe(
      '2026-08-13T00:00:00.000Z'
    );
  });

  it('hashes only immutable ingress identity so policy/model drift can replay', () => {
    const request = {
      projectId: 'project_1',
      initiatedBy: 'user_1',
      kind: 'backlog_triage' as const,
      requestedDryRun: false,
    };
    expect(hashProjectAgentIngressRequest(request)).toBe(
      hashProjectAgentIngressRequest({ ...request })
    );
  });

  it('uses a single absolute 120 second deadline across recoveries', () => {
    const startedAt = new Date('2026-08-12T12:00:00.000Z');
    expect(getProjectAgentDeadline(startedAt).toISOString()).toBe('2026-08-12T12:02:00.000Z');
  });

  it('never serializes durable state or raw provider errors to browser consumers', () => {
    const durableRun = {
      id: 'run_1',
      projectId: 'project_1',
      kind: 'project_tracking',
      status: 'failed',
      dryRun: false,
      summary: null,
      writeActionsCount: 0,
      output: {
        error: 'provider secret and internal stack',
        errorCode: 'provider_server_error',
        httpStatus: 503,
      },
      logs: [],
      createdAt: new Date('2026-08-12T12:00:00.000Z'),
      updatedAt: new Date('2026-08-12T12:00:01.000Z'),
      startedAt: new Date('2026-08-12T12:00:00.100Z'),
      completedAt: new Date('2026-08-12T12:00:01.000Z'),
      mode: 'assistive',
      checkpoint: { state: { tenantSecret: true } },
      requestHash: 'internal-hash',
      idempotencyKey: 'internal-key',
      leaseOwner: 'worker-secret',
      input: { writeDisposition: 'live' },
    } as never;

    const serialized = serializeProjectAgentRun(durableRun);
    expect(serialized.output).toEqual({
      errorCode: 'provider_server_error',
      httpStatus: 503,
    });
    expect(serialized).not.toHaveProperty('checkpoint');
    expect(serialized).not.toHaveProperty('requestHash');
    expect(serialized).not.toHaveProperty('idempotencyKey');
    expect(serialized).not.toHaveProperty('leaseOwner');
    expect(serializeProjectAgentRunEnvelope(durableRun).output).not.toHaveProperty('error');
  });

  it('does not misclassify expired or stolen leases as cancellation', () => {
    expect(classifyProjectAgentGuardMiss(null)).toBe('lease_lost');
    expect(classifyProjectAgentGuardMiss({ status: 'running', cancelRequestedAt: null })).toBe(
      'lease_lost'
    );
    expect(
      classifyProjectAgentGuardMiss({ status: 'running', cancelRequestedAt: new Date() })
    ).toBe('cancelled');
    expect(classifyProjectAgentGuardMiss({ status: 'cancelled', cancelRequestedAt: null })).toBe(
      'cancelled'
    );
  });

  it('recognizes a lost lease through graph error causes', () => {
    const wrapped = new Error('graph node failed', { cause: new ProjectAgentLeaseLost() });
    expect(isProjectAgentLeaseLost(wrapped)).toBe(true);
    expect(isProjectAgentLeaseLost(new Error('ordinary failure'))).toBe(false);
  });

  it('fails open on notification localization errors so terminal persistence can continue', async () => {
    const { db } = jest.requireMock('@validteam/db') as { db: { select: jest.Mock } };
    db.select.mockImplementationOnce(() => {
      throw new Error('catalog unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      getLocalizedRunFailureCopy({ initiatedBy: 'user_1' } as never)
    ).resolves.toBeNull();
    errorSpy.mockRestore();
  });

  it('uses the canonical agentShared run-message namespace', async () => {
    const { db } = jest.requireMock('@validteam/db') as { db: { select: jest.Mock } };
    db.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [{ locale: 'en' }] }) }),
    });
    await expect(
      getLocalizedRunFailureCopy({ initiatedBy: 'user_1', kind: 'project_tracking' } as never)
    ).resolves.toEqual({
      summary: 'Agent run failed',
      title: 'Agent run failed · Project health scan',
      message: 'Agent run failed',
    });
  });
});
