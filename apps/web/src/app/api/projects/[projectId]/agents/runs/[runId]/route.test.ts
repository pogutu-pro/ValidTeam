/** @jest-environment node */

const authMock = jest.fn();
const accessMock = jest.fn();
const cancelMock = jest.fn();
const resumeMock = jest.fn();
const processMock = jest.fn();
const afterMock = jest.fn();
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

class MockResumeConflict extends Error {}
class MockAdmissionError extends Error {
  code = 'concurrency_limit_reached';
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
jest.mock('@/lib/agents/engine', () => ({
  processProjectAgentRunQueue: (...args: unknown[]) => processMock(...args),
}));
jest.mock('@/lib/agents/project-agent-run-store', () => ({
  ProjectAgentAdmissionError: MockAdmissionError,
  ProjectAgentResumeConflict: MockResumeConflict,
  requestProjectAgentRunCancellation: (...args: unknown[]) => cancelMock(...args),
  resumeProjectAgentRun: (...args: unknown[]) => resumeMock(...args),
  serializeProjectAgentRun: (run: Record<string, unknown>) => ({
    id: run.id,
    status: run.status,
  }),
}));
jest.mock('@/lib/agents/system', () => ({
  getSystemAgentControlSettingsFromDb: () => systemControlMock(),
}));

describe('project agent run control route', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    accessMock.mockResolvedValue({
      canManage: true,
      project: { id: 'project_1', organizationId: 'org_1' },
    });
    systemControlMock.mockResolvedValue({ maxConcurrentRuns: 6 });
  });

  it('returns an idempotent terminal run for cancel', async () => {
    cancelMock.mockResolvedValue({ id: 'run_1', status: 'completed' });
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1', runId: 'run_1' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: { id: 'run_1', status: 'completed' },
    });
  });

  it('never returns durable checkpoint or lease metadata', async () => {
    cancelMock.mockResolvedValue({
      id: 'run_1',
      status: 'running',
      checkpoint: { secretTenantContext: true },
      leaseOwner: 'worker-secret',
      requestHash: 'internal-hash',
    });
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1', runId: 'run_1' }) }
    );

    await expect(response.json()).resolves.toEqual({ run: { id: 'run_1', status: 'running' } });
  });

  it('returns 409 when a run state or graph version cannot resume', async () => {
    resumeMock.mockRejectedValue(new MockResumeConflict('unsupported graph version'));
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1', runId: 'run_1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'unsupported graph version' });
    expect(processMock).not.toHaveBeenCalled();
  });

  it('returns a resumed run immediately and drains it after the response', async () => {
    resumeMock.mockResolvedValue({ id: 'run_1', status: 'pending' });
    processMock.mockResolvedValue({ summary: {}, run: null });
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1', runId: 'run_1' }) }
    );

    expect(response.status).toBe(202);
    expect(resumeMock).toHaveBeenCalledWith({
      runId: 'run_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      maxConcurrentRuns: 6,
    });
    expect(processMock).not.toHaveBeenCalled();
    await afterMock.mock.calls[0]![0]();
    expect(processMock).toHaveBeenCalledWith({
      runId: 'run_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      limit: 1,
    });
  });

  it('returns 429 when resume cannot reserve a global active slot', async () => {
    resumeMock.mockRejectedValue(new MockAdmissionError('Too many runs'));
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
      }) as never,
      { params: Promise.resolve({ projectId: 'project_1', runId: 'run_1' }) }
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many runs',
      code: 'concurrency_limit_reached',
    });
  });
});
