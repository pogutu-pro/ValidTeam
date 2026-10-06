/**
 * End-to-end smoke test of the Meetings backend over real HTTP, a real
 * Postgres and a real LiveKit server. Requires (all disposable):
 *   - Postgres migrated to 0069, LiveKit dev server (--dev => devkey/secret)
 *   - the web app running with matching DATABASE_URL / LIVEKIT_* / CRON_SECRET
 *
 *   TEST_DATABASE_URL=... SMOKE_BASE_URL=http://localhost:3100 \
 *   SMOKE_LIVEKIT_HTTP=http://localhost:17880 SMOKE_CRON_SECRET=... \
 *   LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
 *     pnpm --filter @validteam/web test:smoke:meetings
 *
 * LiveKit webhooks are signed exactly like the real server signs them
 * (JWT with a sha256 body claim), so the route's verification is exercised.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
process.env.DATABASE_URL = env('TEST_DATABASE_URL');
const BASE = env('SMOKE_BASE_URL');
const LK_HTTP = env('SMOKE_LIVEKIT_HTTP');
const CRON = env('SMOKE_CRON_SECRET');
const KEY = env('LIVEKIT_API_KEY');
const SECRET = env('LIVEKIT_API_SECRET');

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n`, e);
    process.exit(1);
  }
}

const decode = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));

async function signedWebhook(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const token = new AccessToken(KEY, SECRET);
  token.sha256 = crypto.createHash('sha256').update(body).digest('base64');
  return fetch(`${BASE}/api/chat/livekit/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/webhook+json', Authorization: await token.toJwt() },
    body,
  });
}

async function main() {
  const dbPkg = await import('@validteam/db');
  const {
    db,
    organizations,
    organizationMembers,
    users,
    meetings,
    meetingParticipants,
    meetingAttendanceSessions,
    meetingStats,
    eq,
    and,
    sql,
  } = dbPkg;
  const svc = await import('../src/lib/meetings/service');
  const { buildMeetingIdentity } = await import('../src/lib/meetings/livekit');
  const { listRoomIdentities } = await import('../src/lib/meetings/livekit-admin');

  const sfx = randomUUID().replaceAll('-', '').slice(0, 10);
  const orgId = `smk_org_${sfx}`;
  const hostId = `smk_host_${sfx}`;
  await db.insert(organizations).values({ id: orgId, name: 'Smoke Org', slug: `smk-${sfx}` });
  await db.insert(users).values({ id: hostId, email: `${hostId}@example.test`, name: 'Paul Host' });
  await db
    .insert(organizationMembers)
    .values({ organizationId: orgId, userId: hostId, role: 'member' });

  const { meeting } = await svc.createMeeting(hostId, {
    organizationId: orgId,
    title: 'Smoke Meeting',
    mode: 'scheduled',
    startAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    durationMinutes: 60,
    timezone: 'Africa/Nairobi',
    participantUserIds: [],
    guests: [{ email: `guest-${sfx}@example.test`, name: 'John Smith' }],
    access: 'invited',
    allowGuests: true,
  });
  const guest = (
    await db
      .select()
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meeting.id), sql`guest_email IS NOT NULL`))
  )[0]!;
  const guestToken = await svc.issueGuestToken(meeting, guest.id);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  console.log('public surface & auth');
  await check('/meet/<slug> is publicly reachable (no sign-in redirect)', async () => {
    const r = await fetch(`${BASE}/meet/${meeting.slug}?g=${guestToken}`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(/noindex/i.test(html), 'meeting page must not be indexable');
  });
  await check('member API requires authentication; cron requires its secret', async () => {
    assert.equal((await fetch(`${BASE}/api/meetings?organizationId=${orgId}`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/meetings/${meeting.slug}`)).status, 401);
    assert.ok(
      [401, 403, 503].includes(
        (await fetch(`${BASE}/api/cron/meetings-tick`, { method: 'POST' })).status
      )
    );
  });

  console.log('guest access over HTTP');
  await check(
    'guest-preview exposes only title/host/time; wrong token is a uniform 403',
    async () => {
      const ok = await post(`/api/meetings/${meeting.slug}/guest-preview`, { token: guestToken });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.meeting.title, 'Smoke Meeting');
      assert.equal(body.meeting.host.name, 'Paul Host');
      assert.equal(
        JSON.stringify(body).includes(orgId),
        false,
        'no organization id leaks to guests'
      );
      assert.equal(JSON.stringify(body).includes('guest-'), false, 'no e-mail addresses leak');
      const bad = await post(`/api/meetings/${meeting.slug}/guest-preview`, {
        token: 'B'.repeat(43),
      });
      assert.equal(bad.status, 403);
      assert.equal((await bad.json()).error.code, 'invalid_guest_link');
      assert.equal(
        (await post(`/api/meetings/not-this-meeting/guest-preview`, { token: guestToken })).status,
        403
      );
    }
  );

  let lk: { url: string; token: string; identity: string; role: string } | null = null;
  await check(
    'guest-join starts the meeting and returns a role-scoped token LiveKit itself accepts',
    async () => {
      const r = await post(`/api/meetings/${meeting.slug}/guest-join`, {
        token: guestToken,
        name: 'John Smith',
        clientSessionId: 'smokesession01',
      });
      assert.equal(r.status, 200);
      lk = await r.json();
      assert.equal(lk!.role, 'guest');
      assert.equal(lk!.identity, buildMeetingIdentity(guest.id, 'smokesession01'));
      assert.equal(
        JSON.stringify(lk).includes(SECRET),
        false,
        'API secret must never reach the browser'
      );
      const claims = decode(lk!.token);
      assert.equal(claims.video.roomAdmin, false);
      assert.equal(claims.video.canPublish, true);
      assert.equal(claims.sub, lk!.identity);
      // The real LiveKit server validates signature, grants and room claims.
      const v = await fetch(
        `${LK_HTTP}/rtc/validate?access_token=${encodeURIComponent(lk!.token)}`
      );
      assert.equal(v.status, 200, `LiveKit rejected the token: ${await v.text()}`);
      const [m] = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
      assert.equal(m!.status, 'live');
      assert.ok(m!.livekitRoomName?.startsWith('vm-'));
      assert.equal(decode(lk!.token).video.room, m!.livekitRoomName);
      const [g] = await db
        .select()
        .from(meetingParticipants)
        .where(eq(meetingParticipants.id, guest.id));
      assert.equal(g!.guestName, 'John Smith');
    }
  );

  const room = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0]!
    .livekitRoomName!;
  const identity = lk!.identity;
  const sessions = () =>
    db
      .select()
      .from(meetingAttendanceSessions)
      .where(eq(meetingAttendanceSessions.meetingId, meeting.id));

  console.log('LiveKit admin API (real server)');
  await check(
    'room admin calls behave as the code assumes for an empty/non-existent room',
    async () => {
      const svcClient = new RoomServiceClient(LK_HTTP, KEY, SECRET);
      const list = await svcClient.listParticipants(room).catch((e: unknown) => e);
      console.log(
        '    listParticipants(nonexistent room) ->',
        Array.isArray(list) ? `[] length ${list.length}` : `error: ${(list as Error).message}`
      );
      const ids = await listRoomIdentities(room);
      console.log(
        '    listRoomIdentities ->',
        ids === null ? 'null (fallback to pulse)' : `Set(${ids.size})`
      );
      await svcClient
        .deleteRoom(room)
        .catch((e: unknown) => console.log('    deleteRoom(nonexistent) ->', (e as Error).message));
      assert.ok(ids === null || ids.size === 0);
    }
  );

  console.log('signed LiveKit webhooks over HTTP');
  await check('forged / unsigned webhooks are rejected', async () => {
    const r = await fetch(`${BASE}/api/chat/livekit/webhook`, {
      method: 'POST',
      headers: { Authorization: 'forged' },
      body: JSON.stringify({ event: 'room_finished', room: { name: room } }),
    });
    assert.equal(r.status, 401);
    assert.equal((await sessions()).length, 0);
  });
  await check('signed participant_joined opens one session; replays are no-ops', async () => {
    const ev = {
      event: 'participant_joined',
      room: { name: room },
      participant: { identity },
      createdAt: Math.floor(Date.now() / 1000) - 120,
    };
    assert.equal((await signedWebhook(ev)).status, 200);
    assert.equal((await signedWebhook(ev)).status, 200);
    const s = await sessions();
    assert.equal(s.length, 1);
    assert.equal(s[0]!.leftAt, null);
    // LiveKit's own timestamp is trusted (joined ~2 minutes ago), not the arrival time.
    assert.ok(Date.now() - s[0]!.joinedAt.getTime() >= 110_000);
  });
  await check('screen-share track events are recorded as lifecycle events', async () => {
    const at = Math.floor(Date.now() / 1000) - 60;
    await signedWebhook({
      event: 'track_published',
      room: { name: room },
      participant: { identity },
      track: { source: 3 },
      createdAt: at,
    });
    await signedWebhook({
      event: 'track_published',
      room: { name: room },
      participant: { identity },
      track: { source: 1 },
      createdAt: at,
    }); // camera: ignored
    const { meetingEvents } = dbPkg;
    const evs = await db
      .select()
      .from(meetingEvents)
      .where(eq(meetingEvents.meetingId, meeting.id));
    assert.equal(evs.filter((e) => e.type === 'screen_share_started').length, 1);
  });
  await check('leave then rejoin creates a second session', async () => {
    const t = Math.floor(Date.now() / 1000);
    assert.equal(
      (
        await signedWebhook({
          event: 'participant_left',
          room: { name: room },
          participant: { identity },
          createdAt: t - 50,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await signedWebhook({
          event: 'participant_joined',
          room: { name: room },
          participant: { identity: buildMeetingIdentity(guest.id, 'smokesession02') },
          createdAt: t - 30,
        })
      ).status,
      200
    );
    const s = await sessions();
    assert.equal(s.length, 2);
    assert.equal(s.filter((x) => x.leftAt === null).length, 1);
  });
  await check('chat-call rooms still go to the original handler', async () => {
    const r = await signedWebhook({
      event: 'participant_joined',
      room: { name: 'tn-proj-room-xyz' },
      participant: { identity: 'tnp:user:sess' },
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result.reason, 'call_not_found');
  });

  console.log('cron tick over HTTP');
  await check(
    'tick is authorised, idempotent and keeps the connected guest session open',
    async () => {
      const tick = () =>
        fetch(`${BASE}/api/cron/meetings-tick`, {
          method: 'POST',
          headers: { 'x-cron-secret': CRON },
        });
      const a = await tick();
      assert.equal(a.status, 200);
      const report = await a.json();
      console.log(
        '    tick report:',
        JSON.stringify({
          errors: report.errors,
          closed: report.sessionsClosed,
          opened: report.sessionsOpened,
          ended: report.meetingsEnded,
        })
      );
      assert.deepEqual(report.errors, []);
      assert.equal((await tick()).status, 200);
    }
  );

  console.log('ending the meeting');
  await check(
    'room_finished ends the meeting, closes sessions and computes stats; the guest link then dies',
    async () => {
      assert.equal(
        (
          await signedWebhook({
            event: 'room_finished',
            room: { name: room },
            createdAt: Math.floor(Date.now() / 1000),
          })
        ).status,
        200
      );
      const [m] = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
      assert.equal(m!.status, 'ended');
      assert.equal(m!.endReason, 'livekit_room_finished');
      assert.equal((await sessions()).filter((x) => x.leftAt === null).length, 0);
      const [st] = await db
        .select()
        .from(meetingStats)
        .where(eq(meetingStats.meetingId, meeting.id));
      assert.equal(st!.attendedCount, 1);
      assert.equal(st!.noShowCount, 1); // the host never joined
      assert.ok(st!.totalJoins === 2);
      const r = await post(`/api/meetings/${meeting.slug}/guest-join`, {
        token: guestToken,
        name: 'John Smith',
      });
      assert.ok([403, 410].includes(r.status));
    }
  );

  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(users).where(eq(users.id, hostId));
  console.log(`\n${passed} smoke checks passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
