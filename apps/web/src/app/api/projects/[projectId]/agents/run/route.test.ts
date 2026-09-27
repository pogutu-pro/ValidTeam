/** @jest-environment node */

const authMock = jest.fn();
const accessMock = jest.fn();
const runMock = jest.fn();
const processMock = jest.fn();
const replayMock = jest.fn();
const serializeMock = jest.fn((run: unknown) => ({ run }));
const afterMock = jest.fn();
const dbSelectMock = jest.fn();
const modelConfigMock = jest.fn();
const systemControlMock = jest.fn();

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
  after: (callback: () => Promise<void>) => afterMock(callback),
}));
jest.mock('@/auth', () => ({ auth: () => authMock() }));
jest.mock('@/lib/agents/access', () => ({
  getProjectAgentAccess: (...args: unknown[]) => accessMock(...args),
}));
jest.mock('@/lib/ai/feature-gate', () => ({
  isAiFeatureEnabled: jest.fn().mockResolvedValue(true),
  aiDisabledResponse: jest.fn(),
}));
jest.mock('@/lib/agents/engine', () => {
  class ProjectAgentAdmissionError extends Error {}
  class ProjectAgentIdempotencyConflict extends Error {}
  return {
    ProjectAgentAdmissionError,
    ProjectAgentIdempotencyConflict,
    enqueueProjectAgentRun: (...args: unknown[]) => runMock(...args),
    processProjectAgentRunQueue: (...args: unknown[]) => processMock(...args),
  };
});
jest.mock('@/lib/agents/project-agent-run-store', () => ({
  findDurableProjectAgentRunReplay: (...args: unknown[]) => replayMock(...args),
  serializeProjectAgentRunEnvelope: (...args: unknown[]) => serializeMock(...args),
}));
jest.mock('@tasknebula/db', () => ({
  db: { select: (...args: unknown[]) => dbSelectMock(...args) },
  eq: jest.fn(),
  organizations: {},
  projects: {},
}));
jest.mock('@/lib/agents/model-configs', () => ({
  applyWorkspaceModelConfig: (...args: unknown[]) => modelConfigMock(...args),
}));
jest.mock('@/lib/agents/system', () => ({
  getSystemAgentControlSettingsFromDb: (...args: unknown[]) => systemControlMock(...args),
}));
jest.mock('@/lib/agents/credentials', () => ({
  getProviderCredentialStatusFromSettings: jest.fn(),
  resolveProviderApiKeyFromSettings: jest.fn(),
}));

describe('POST project agent run idempotency contract', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    accessMock.mockResolvedValue({
      canManage: true,
      project: { id: 'project_1', organizationId: 'org_1', key: 'NEB' },
    });
    replayMock.mockResolvedValue(null);
    processMock.mockResolvedValue({ summary: {}, run: null });
  });

  it('returns 428 before parsing or starting when Idempotency-Key is absent', async () => {
    const response = await POST(
      new Request('http://localhost/api/projects/project_1/agents/run', {
        method: 'POST',
        body: JSON.stringify({ kind: 'project_tracking' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1' }) }
    );

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toEqual({ error: 'Idempotency-Key header is required' });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('rejects an unsafe idempotency key', async () => {
    const response = await POST(
      new Request('http://localhost/api/projects/project_1/agents/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'contains spaces' },
        body: JSON.stringify({ kind: 'project_tracking' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1' }) }
    );

    expect(response.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns an accepted replay before loading changed provider configuration', async () => {
    replayMock.mockResolvedValue({
      id: 'run_1',
      status: 'completed',
      output: { ok: true },
      error: null,
    });
    const response = await POST(
      new Request('http://localhost/api/projects/project_1/agents/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'stable-key' },
        body: JSON.stringify({ kind: 'project_tracking', dryRun: false }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1' }) }
    );

    expect(response.status).toBe(200);
    expect(replayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        projectId: 'project_1',
        initiatedBy: 'user_1',
        kind: 'project_tracking',
        requestedDryRun: false,
      })
    );
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 202 before executing and schedules a scoped best-effort drain', async () => {
    const chain = (rows: unknown[]) => ({
      from: () => ({ where: () => ({ limit: async () => rows }) }),
    });
    dbSelectMock
      .mockReturnValueOnce(
        chain([
          {
            id: 'project_1',
            organizationId: 'org_1',
            settings: { aiAgents: { enabled: true } },
          },
        ])
      )
      .mockReturnValueOnce(
        chain([{ id: 'org_1', settings: { aiAgents: { provider: 'native' } } }])
      );
    const workspaceSettings = {
      provider: 'native',
      model: 'tasknebula-planner-v1',
      enabled: true,
      assistantEnabled: false,
      executionMode: 'manual',
      allowWriteActions: false,
      requireApprovalForWrites: true,
      dailyRunLimit: 20,
      capabilities: {
        project_tracking: true,
        backlog_triage: true,
        sprint_planning: true,
        bulk_sprint_creation: true,
      },
      aiOversight: 'review_required',
      aiSafetyMode: 'warn',
    };
    modelConfigMock.mockResolvedValue({ workspaceSettings, selectedModelConfig: null });
    systemControlMock.mockResolvedValue({
      globalEnabled: true,
      allowWriteActions: true,
      requireSupervisionForAutoMode: true,
      maxConcurrentRuns: 6,
    });
    runMock.mockResolvedValue({
      run: { id: 'run_1', status: 'pending', error: null },
      output: {},
      dryRun: false,
      forcedDryRun: false,
      approvalRequired: false,
      writeDisposition: 'read_only',
      httpStatus: 202,
    });

    const response = await POST(
      new Request('http://localhost/api/projects/project_1/agents/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'async-start' },
        body: JSON.stringify({ kind: 'project_tracking', dryRun: false }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1' }) }
    );

    expect(response.status).toBe(202);
    expect(processMock).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]![0]();
    expect(processMock).toHaveBeenCalledWith({
      runId: 'run_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      limit: 1,
    });
  });
});
