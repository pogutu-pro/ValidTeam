/**
 * @jest-environment node
 */

const requireCronAuthMock = jest.fn();
const processEffectsMock = jest.fn();

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
jest.mock('@/lib/agent-policy/approval-effects', () => ({
  processApprovalEffectOutbox: (...args: unknown[]) => processEffectsMock(...args),
}));

describe('POST /api/cron/agent-approval-effects', () => {
  let POST: typeof import('./route').POST;

  beforeAll(async () => {
    ({ POST } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requireCronAuthMock.mockReturnValue(null);
    processEffectsMock.mockResolvedValue({ claimed: 2, completed: 1, retried: 1, failed: 0 });
  });

  it('returns the shared cron auth denial without touching the outbox', async () => {
    const denied = MockNextResponse.json({ error: 'unauthorized' }, { status: 401 });
    requireCronAuthMock.mockReturnValue(denied);

    const response = await POST(new Request('http://localhost', { method: 'POST' }) as never);

    expect(response).toBe(denied);
    expect(processEffectsMock).not.toHaveBeenCalled();
  });

  it('caps the requested batch and returns the processing summary', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 1_000 }),
      }) as never
    );

    expect(processEffectsMock).toHaveBeenCalledWith({ limit: 100 });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 2,
      completed: 1,
      retried: 1,
      failed: 0,
    });
  });

  it('rejects malformed JSON without draining the outbox', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }) as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Malformed JSON body' });
    expect(processEffectsMock).not.toHaveBeenCalled();
  });
});
