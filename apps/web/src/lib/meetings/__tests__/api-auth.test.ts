/** @jest-environment node */
const resolveApiActorMock = jest.fn();
jest.mock('@/lib/auth/api-actor', () => ({
  resolveApiActor: (...a: unknown[]) => resolveApiActorMock(...a),
}));
jest.mock('@/lib/auth/access-control', () => ({
  resolveOrganizationAccess: jest.fn().mockResolvedValue({ allowed: false, role: null }),
}));

const ctx = (id = 'slug1234567890ab') => ({ params: Promise.resolve({ id }) });
const req = (path: string, init: RequestInit = {}) => new Request(`http://x${path}`, init);

describe('meetings API authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'c'.repeat(32);
  });

  it('requires authentication for list/create', async () => {
    resolveApiActorMock.mockResolvedValue(null);
    const { GET, POST } = await import('@/app/api/meetings/route');
    expect((await GET(req('/api/meetings?organizationId=o1'))).status).toBe(401);
    expect((await POST(req('/api/meetings', { method: 'POST', body: '{}' }))).status).toBe(401);
  });

  it('validates create input with the standard envelope', async () => {
    resolveApiActorMock.mockResolvedValue({
      userId: 'u1',
      organizationId: null,
      authType: 'session',
    });
    const { POST } = await import('@/app/api/meetings/route');
    const res = await POST(
      req('/api/meetings', { method: 'POST', body: JSON.stringify({ title: '' }) })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
    const bad = await POST(req('/api/meetings', { method: 'POST', body: '{nope' }));
    expect((await bad.json()).error.code).toBe('INVALID_JSON');
  });

  it('answers 404 (not 403) for organizations the caller does not belong to', async () => {
    resolveApiActorMock.mockResolvedValue({
      userId: 'u1',
      organizationId: null,
      authType: 'session',
    });
    const { GET } = await import('@/app/api/meetings/route');
    expect((await GET(req('/api/meetings?organizationId=other-org'))).status).toBe(404);
  });

  it('confines API keys to their own organization', async () => {
    resolveApiActorMock.mockResolvedValue({
      userId: 'u1',
      organizationId: 'org-key',
      authType: 'api_key',
    });
    const { GET } = await import('@/app/api/meetings/route');
    expect((await GET(req('/api/meetings?organizationId=org-other'))).status).toBe(404);
  });

  it('org analytics: unauthenticated 401, bad range 400', async () => {
    const { GET } = await import('@/app/api/meetings/analytics/route');
    resolveApiActorMock.mockResolvedValue(null);
    expect(
      (
        await GET(
          req(
            '/api/meetings/analytics?organizationId=o&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z'
          )
        )
      ).status
    ).toBe(401);
    resolveApiActorMock.mockResolvedValue({
      userId: 'u1',
      organizationId: null,
      authType: 'session',
    });
    const res = await GET(
      req(
        '/api/meetings/analytics?organizationId=o&from=2026-01-01T00:00:00Z&to=2030-02-01T00:00:00Z'
      )
    );
    expect(res.status).toBe(400);
  });

  it('guest-join rejects malformed tokens uniformly, without touching the database', async () => {
    const { POST } = await import('@/app/api/meetings/[id]/guest-join/route');
    const res = await POST(
      req('/api/meetings/x/guest-join', {
        method: 'POST',
        body: JSON.stringify({ token: 'not-a-token' }),
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('invalid_guest_link');
  });

  it('guest-join is rate limited per client and meeting', async () => {
    const { POST } = await import('@/app/api/meetings/[id]/guest-join/route');
    const call = () =>
      POST(
        req('/api/meetings/x/guest-join', {
          method: 'POST',
          body: JSON.stringify({ token: 'bad' }),
          headers: { 'x-forwarded-for': '9.9.9.9' },
        }),
        ctx('ratelimited-slug-1')
      );
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call()).status;
    expect(last).toBe(429);
  });

  it('cron tick requires the cron secret', async () => {
    const { POST } = await import('@/app/api/cron/meetings-tick/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://x/api/cron/meetings-tick', { method: 'POST' }));
    expect([401, 403]).toContain(res.status);
  });
});
