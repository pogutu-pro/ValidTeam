/** @jest-environment node */

const requireCronAuthMock = jest.fn();
const processRunsMock = jest.fn();

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

jest.mock('next/server', () => ({ NextResponse: MockNextResponse }));
jest.mock('@/lib/agents/cron-auth', () => ({
  requireCronAuth: (...args: unknown[]) => requireCronAuthMock(...args),
}));
jest.mock('@/lib/agents/engine', () => ({
  processProjectAgentRunQueue: (...args: unknown[]) => processRunsMock(...args),
}));

describe('POST /api/cron/agent-runs', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requireCronAuthMock.mockReturnValue(null);
    processRunsMock.mockResolvedValue({
      summary: { claimed: 2, completed: 1, failed: 1, cancelled: 0 },
    });
  });

  it('returns shared cron denial without running the worker', async () => {
    const denied = MockNextResponse.json({ error: 'unauthorized' }, { status: 401 });
    requireCronAuthMock.mockReturnValue(denied);

    const response = await POST(new Request('http://localhost', { method: 'POST' }) as never);

    expect(response).toBe(denied);
    expect(processRunsMock).not.toHaveBeenCalled();
  });

  it('caps the batch size and returns the worker summary', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ limit: 1000 }),
      }) as never
    );

    expect(processRunsMock).toHaveBeenCalledWith({ limit: 25 });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 2,
      completed: 1,
      failed: 1,
      cancelled: 0,
    });
  });

  it('accepts an empty body and uses the default batch size', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST' }) as never);

    expect(response.status).toBe(200);
    expect(processRunsMock).toHaveBeenCalledWith({ limit: 10 });
  });

  it('rejects malformed non-empty JSON instead of silently draining defaults', async () => {
    const response = await POST(
      new Request('http://localhost', { method: 'POST', body: '{bad' }) as never
    );

    expect(response.status).toBe(400);
    expect(processRunsMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid limit type', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ limit: '25' }),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(processRunsMock).not.toHaveBeenCalled();
  });
});
