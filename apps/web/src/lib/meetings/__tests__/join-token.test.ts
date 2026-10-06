/** @jest-environment node */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jwtDecode = (token: string): any =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));

jest.mock('@/lib/admin/system-settings', () => ({ resolveLivekitConfig: async () => null }));

describe('issueMeetingToken', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = {
      ...env,
      LIVEKIT_URL: 'ws://lk.internal:7880',
      NEXT_PUBLIC_LIVEKIT_URL: 'wss://lk.example.test',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'x'.repeat(40),
    };
  });
  afterAll(() => {
    process.env = env;
  });

  const meeting = (over = {}) =>
    ({
      id: 'm1',
      slug: 's',
      organizationId: 'o1',
      livekitRoomName: 'vm-room1',
      scheduledStartAt: new Date(Date.now() + 3600_000),
      scheduledEndAt: new Date(Date.now() + 7200_000),
      ...over,
    }) as never;
  const participant = { id: 'part1' } as never;

  it.each([
    ['host', true],
    ['participant', false],
    ['guest', false],
  ] as const)(
    '%s token: room-scoped, admin=%s, identity bound to participant',
    async (role, admin) => {
      const { issueMeetingToken } = await import('../join');
      const out = await issueMeetingToken({
        meeting: meeting(),
        participant,
        role,
        displayName: 'N',
        clientSessionId: 'abcdefgh12',
      });
      const claims = jwtDecode(out.token);
      expect(claims.video).toMatchObject({
        room: 'vm-room1',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      expect(Boolean(claims.video.roomAdmin)).toBe(admin);
      // Raise-hand state is stored in participant attributes, which needs this grant.
      expect(claims.video.canUpdateOwnMetadata).toBe(true);
      expect(claims.sub).toBe('vm:part1:abcdefgh12');
      expect(out.url).toBe('wss://lk.example.test');
      // The API secret never appears in anything returned to the browser.
      expect(JSON.stringify(out)).not.toContain('x'.repeat(40));
      const ttl = claims.exp - Math.floor(Date.now() / 1000);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(6 * 3600);
    }
  );

  it('rejects joining a room that has not been assigned yet', async () => {
    const { issueMeetingToken } = await import('../join');
    await expect(
      issueMeetingToken({
        meeting: meeting({ livekitRoomName: null }),
        participant,
        role: 'participant',
        displayName: 'N',
      })
    ).rejects.toMatchObject({ code: 'meeting_not_live' });
  });

  it('reports a 503 when LiveKit is not configured', async () => {
    process.env.LIVEKIT_API_KEY = '';
    const { issueMeetingToken } = await import('../join');
    await expect(
      issueMeetingToken({ meeting: meeting(), participant, role: 'participant', displayName: 'N' })
    ).rejects.toMatchObject({ code: 'livekit_unavailable', status: 503 });
  });
});
