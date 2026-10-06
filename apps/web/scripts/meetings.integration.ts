/**
 * Real-Postgres verification of the Meetings backend (Phase 1): creation,
 * recurrence, org isolation, guest tokens, attendance sessions, webhook
 * handling, stats math, cron idempotency and organization analytics.
 * Run only against a disposable migrated database:
 *   TEST_DATABASE_URL=postgres://postgres:pg@localhost:5499/postgres \
 *     pnpm --filter @validteam/web test:integration:meetings
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error('TEST_DATABASE_URL is required; refusing to run against an implicit database');
process.env.DATABASE_URL = url;

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n`, e);
    process.exitCode = 1;
    throw e;
  }
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
    meetingNotifications,
    meetingStats,
    meetingEvents,
    meetingGuestTokens,
    meetingSeries,
    eq,
    and,
    sql,
  } = dbPkg;
  const svc = await import('../src/lib/meetings/service');
  const access = await import('../src/lib/meetings/access');
  const { handleMeetingWebhookEvent } = await import('../src/lib/meetings/webhook');
  const { runMeetingTick } = await import('../src/lib/meetings/tick');
  const analytics = await import('../src/lib/meetings/analytics');
  const { buildMeetingIdentity } = await import('../src/lib/meetings/livekit');
  const { MeetingError } = await import('../src/lib/meetings/errors');

  const sfx = randomUUID().replaceAll('-', '').slice(0, 10);
  const id = (n: string) => `mt_${n}_${sfx}`;
  const org = { A: id('orgA'), B: id('orgB') };
  const u = {
    host: id('host'),
    a: id('a'),
    b: id('b'),
    c: id('c'),
    outsider: id('out'),
    admin: id('adm'),
  };

  await db.insert(organizations).values([
    { id: org.A, name: 'Org A', slug: `a-${sfx}` },
    { id: org.B, name: 'Org B', slug: `b-${sfx}` },
  ]);
  const emails = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, `${v}@example.test`]));
  await db
    .insert(users)
    .values(Object.entries(u).map(([k, v]) => ({ id: v, email: emails[k]!, name: k })));
  await db
    .insert(organizationMembers)
    .values([
      ...[u.host, u.a, u.b, u.c].map((userId) => ({
        organizationId: org.A,
        userId,
        role: 'member' as const,
      })),
      { organizationId: org.A, userId: u.admin, role: 'admin' as const },
      { organizationId: org.B, userId: u.outsider, role: 'member' as const },
    ]);

  const minute = 60_000;
  const now = new Date();
  const part = async (meetingId: string, userId: string) =>
    (
      await db
        .select()
        .from(meetingParticipants)
        .where(
          and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, userId))
        )
    )[0]!;

  console.log('creation & participants');
  let m1!: Awaited<ReturnType<typeof svc.createMeeting>>['meeting'];
  await check(
    'scheduled meeting dedupes people and converts member e-mails to internal participants',
    async () => {
      const r = await svc.createMeeting(u.host, {
        organizationId: org.A,
        title: 'Planning',
        mode: 'scheduled',
        startAt: new Date(now.getTime() + 20 * minute).toISOString(),
        durationMinutes: 60,
        timezone: 'Africa/Nairobi',
        participantUserIds: [u.a, u.a, u.b, u.host],
        guests: [
          { email: 'Client@Example.com', name: 'Client' },
          { email: 'client@example.com' },
          { email: emails.c! },
        ],
        access: 'invited',
        allowGuests: true,
      });
      m1 = r.meeting;
      const rows = await db
        .select()
        .from(meetingParticipants)
        .where(eq(meetingParticipants.meetingId, m1.id));
      assert.equal(rows.length, 5); // host, a, b, c(from guest email), 1 guest
      assert.equal(rows.filter((p) => p.guestEmail).length, 1);
      assert.equal(rows.find((p) => p.guestEmail)!.guestEmail, 'client@example.com');
      assert.equal(m1.recordingStatus, 'none');
      assert.equal(m1.transcriptionStatus, 'none');
      assert.equal(m1.captionStatus, 'none');
    }
  );
  await check('rejects participants from another organization', async () => {
    await assert.rejects(
      svc.createMeeting(u.host, {
        organizationId: org.A,
        title: 'X',
        mode: 'scheduled',
        startAt: new Date(now.getTime() + 5 * minute).toISOString(),
        durationMinutes: 30,
        timezone: 'UTC',
        participantUserIds: [u.outsider],
        guests: [],
        access: 'invited',
        allowGuests: true,
      }),
      (e: unknown) => e instanceof MeetingError && e.code === 'invalid_participants'
    );
  });
  await check('instant meeting starts now', async () => {
    const r = await svc.createMeeting(u.host, {
      organizationId: org.A,
      title: 'Quick',
      mode: 'instant',
      durationMinutes: 30,
      timezone: 'UTC',
      participantUserIds: [],
      guests: [],
      access: 'invited',
      allowGuests: true,
    });
    assert.equal(r.meeting.isInstant, true);
    assert.ok(Math.abs(r.meeting.scheduledStartAt.getTime() - Date.now()) < 5_000);
  });

  console.log('recurrence');
  await check(
    'weekly series materialises once; re-materialising creates no duplicates',
    async () => {
      const r = await svc.createMeeting(u.host, {
        organizationId: org.A,
        title: 'Standup',
        mode: 'scheduled',
        startAt: new Date(now.getTime() + 60 * minute).toISOString(),
        durationMinutes: 15,
        timezone: 'America/New_York',
        participantUserIds: [u.a],
        guests: [],
        recurrence: { freq: 'weekly', interval: 1 },
        access: 'invited',
        allowGuests: true,
      });
      assert.ok(r.seriesId);
      assert.ok(
        r.occurrencesCreated >= 8,
        `expected ~9 weekly occurrences, got ${r.occurrencesCreated}`
      );
      const before = (await db.select().from(meetings).where(eq(meetings.seriesId, r.seriesId!)))
        .length;
      await Promise.all([svc.materializeSeries(r.seriesId!), svc.materializeSeries(r.seriesId!)]);
      await svc.materializeSeries(r.seriesId!);
      const after = (await db.select().from(meetings).where(eq(meetings.seriesId, r.seriesId!)))
        .length;
      assert.equal(after, before);
      const keys = (
        await db
          .select({ k: meetings.occurrenceKey })
          .from(meetings)
          .where(eq(meetings.seriesId, r.seriesId!))
      ).map((x) => x.k);
      assert.equal(new Set(keys).size, keys.length);
    }
  );

  console.log('authorization & isolation');
  await check('outsider (other org) gets no principal; invited member and host do', async () => {
    assert.equal(await access.resolveMemberPrincipal(u.outsider, m1), null);
    const a = await access.resolveMemberPrincipal(u.a, m1);
    assert.ok(a && a.canJoin && !a.canManage);
    const h = await access.resolveMemberPrincipal(u.host, m1);
    assert.ok(h && h.isHost && h.canManage);
    const adm = await access.resolveMemberPrincipal(u.admin, m1);
    assert.ok(adm && adm.canManage && !adm.canJoin); // admins manage, but are not auto-invited
  });
  await check('API key bound to another org is rejected', async () => {
    assert.equal(
      await access.resolveMemberPrincipal(u.a, m1, { apiKeyOrganizationId: org.B }),
      null
    );
  });
  await check('organization-open meeting lets any member in; removal still blocks', async () => {
    const r = await svc.createMeeting(u.host, {
      organizationId: org.A,
      title: 'Open',
      mode: 'instant',
      durationMinutes: 30,
      timezone: 'UTC',
      participantUserIds: [],
      guests: [],
      access: 'organization',
      allowGuests: false,
    });
    const c = await access.resolveMemberPrincipal(u.c, r.meeting);
    assert.ok(c && c.canJoin && !c.participant);
    const row = await access.ensureMemberParticipant(r.meeting, c);
    assert.equal(row.userId, u.c);
    assert.equal(await access.resolveMemberPrincipal(u.outsider, r.meeting), null);
  });

  console.log('guest tokens');
  const guestRow = (
    await db
      .select()
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.meetingId, m1.id),
          sql`${meetingParticipants.guestEmail} IS NOT NULL`
        )
      )
  )[0]!;
  let guestToken = '';
  await check('guest token verifies for its meeting only; only a hash is stored', async () => {
    guestToken = await svc.issueGuestToken(m1, guestRow.id);
    const { principal } = await access.resolveGuestPrincipal(m1.slug, guestToken);
    assert.equal(principal.participant.id, guestRow.id);
    const stored = await db
      .select()
      .from(meetingGuestTokens)
      .where(eq(meetingGuestTokens.participantId, guestRow.id));
    assert.ok(stored.every((t) => t.tokenHash !== guestToken && t.tokenHash.length === 64));
    await assert.rejects(
      access.resolveGuestPrincipal('someothermeeting', guestToken),
      (e: unknown) => e instanceof MeetingError && e.code === 'invalid_guest_link'
    );
    await assert.rejects(
      access.resolveGuestPrincipal(m1.slug, 'x'.repeat(43)),
      (e: unknown) => e instanceof MeetingError
    );
  });
  await check('expired and revoked tokens are rejected; removal revokes', async () => {
    await db
      .update(meetingGuestTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(meetingGuestTokens.participantId, guestRow.id));
    await assert.rejects(access.resolveGuestPrincipal(m1.slug, guestToken));
    const fresh = await svc.issueGuestToken(m1, guestRow.id);
    await access.resolveGuestPrincipal(m1.slug, fresh);
    const res = await svc.removeParticipant(m1, guestRow.id, u.host);
    assert.equal(res.removed, true);
    await assert.rejects(access.resolveGuestPrincipal(m1.slug, fresh));
    assert.equal(
      (await svc.removeParticipant(m1, (await part(m1.id, u.host)).id, u.host)).removed,
      false
    ); // host cannot be removed
  });

  console.log('attendance, webhook and stats (brief scenario)');
  // Meeting 10:00-11:00 in the past: A 10:00-10:20 + 10:30-11:00, B 10:05-11:00, C never.
  const base = new Date(now.getTime() - 3 * 3600_000);
  base.setUTCSeconds(0, 0);
  base.setUTCMinutes(0);
  const at = (min: number) => new Date(base.getTime() + min * minute);
  const sc = await svc.createMeeting(u.host, {
    organizationId: org.A,
    title: 'Scenario',
    mode: 'scheduled',
    startAt: new Date(now.getTime() + 10 * minute).toISOString(),
    durationMinutes: 60,
    timezone: 'UTC',
    participantUserIds: [u.a, u.b, u.c],
    guests: [],
    access: 'invited',
    allowGuests: true,
  });
  await db
    .update(meetings)
    .set({ scheduledStartAt: at(0), scheduledEndAt: at(60) })
    .where(eq(meetings.id, sc.meeting.id));
  const live = await svc.ensureMeetingLive(
    (await db.select().from(meetings).where(eq(meetings.id, sc.meeting.id)))[0]!,
    at(0)
  );
  const [pA, pB] = [await part(sc.meeting.id, u.a), await part(sc.meeting.id, u.b)];
  const idA1 = buildMeetingIdentity(pA.id, 'tab1abcd'),
    idA2 = buildMeetingIdentity(pA.id, 'tab2abcd'),
    idB = buildMeetingIdentity(pB.id, 'tab1abcd');
  const hook = (event: string, identity: string, min: number) =>
    handleMeetingWebhookEvent({
      event,
      roomName: live.livekitRoomName!,
      participantIdentity: identity,
      createdAt: Math.floor(at(min).getTime() / 1000),
    });

  await check(
    'webhook join/leave/rejoin builds separate sessions; duplicates are no-ops',
    async () => {
      assert.equal(
        ((await hook('participant_joined', idA1, 0)) as { reason: string }).reason,
        'joined'
      );
      assert.equal(
        ((await hook('participant_joined', idA1, 0)) as { reason: string }).reason,
        'duplicate'
      );
      assert.equal(
        ((await hook('participant_joined', idB, 5)) as { reason: string }).reason,
        'joined'
      );
      assert.equal(
        ((await hook('participant_left', idA1, 20)) as { reason: string }).reason,
        'left'
      );
      assert.equal(
        ((await hook('participant_left', idA1, 20)) as { reason: string }).reason,
        'no_open_session'
      );
      assert.equal(
        ((await hook('participant_joined', idA2, 30)) as { reason: string }).reason,
        'joined'
      );
      const sessionsA = await db
        .select()
        .from(meetingAttendanceSessions)
        .where(eq(meetingAttendanceSessions.participantId, pA.id));
      assert.equal(sessionsA.length, 2);
      const evs = await db
        .select()
        .from(meetingEvents)
        .where(
          and(eq(meetingEvents.meetingId, sc.meeting.id), eq(meetingEvents.participantId, pA.id))
        );
      assert.deepEqual(evs.map((e) => e.type).sort(), [
        'participant_joined',
        'participant_left',
        'participant_rejoined',
      ]);
    }
  );
  await check('forged / foreign identities create no attendance', async () => {
    const foreign = buildMeetingIdentity(guestRow.id, 'tab1abcd'); // participant of ANOTHER meeting
    assert.equal(
      ((await hook('participant_joined', foreign, 6)) as { reason: string }).reason,
      'participant_not_in_meeting'
    );
    assert.equal(
      ((await hook('participant_joined', 'tnp:user:chat', 6)) as { reason: string }).reason,
      'unknown_identity'
    );
    assert.equal(
      (
        await handleMeetingWebhookEvent({
          event: 'participant_joined',
          roomName: 'vm-doesnotexist',
          participantIdentity: idB,
        })
      ).handled,
      false
    );
  });
  await check('removed participant cannot open a session', async () => {
    const pRemoved = await part(sc.meeting.id, u.c);
    await svc.removeParticipant(sc.meeting, pRemoved.id, u.host);
    const r = (await hook(
      'participant_joined',
      buildMeetingIdentity(pRemoved.id, 'tab1abcd'),
      8
    )) as { reason: string };
    assert.equal(r.reason, 'participant_removed');
  });
  await check(
    'meeting ends while B and A are still connected; stats match the hand-computed scenario',
    async () => {
      const res = await svc.endMeeting(sc.meeting.id, {
        by: u.host,
        reason: 'host_ended',
        at: at(60),
      });
      assert.equal(res.ended, true);
      assert.equal(
        (await svc.endMeeting(sc.meeting.id, { reason: 'again', at: at(61) })).ended,
        false
      ); // idempotent
      const [st] = await db
        .select()
        .from(meetingStats)
        .where(eq(meetingStats.meetingId, sc.meeting.id));
      assert.equal(st!.durationSeconds, 60 * 60);
      assert.equal(st!.invitedCount, 3); // host + A + B (C was removed before ever joining => not counted)
      assert.equal(st!.attendedCount, 2);
      assert.equal(st!.noShowCount, 1); // host never joined
      assert.equal(st!.peakConcurrent, 2);
      assert.equal(st!.totalParticipantSeconds, (50 + 55) * 60);
      assert.equal(st!.totalJoins, 3);
      const a = await part(sc.meeting.id, u.a),
        b = await part(sc.meeting.id, u.b);
      assert.equal(a.attendedSeconds, 50 * 60); // 20 + 30, not 60
      assert.equal(a.joinCount, 2);
      assert.equal(a.attendancePct, 83.3);
      assert.equal(b.attendedSeconds, 55 * 60);
      assert.equal(b.attendancePct, 91.7);
      assert.equal((await part(sc.meeting.id, u.host)).noShow, true);
      const open = await db
        .select()
        .from(meetingAttendanceSessions)
        .where(and(eq(meetingAttendanceSessions.meetingId, sc.meeting.id), sql`left_at IS NULL`));
      assert.equal(open.length, 0);
      await assert.rejects(
        svc.ensureMeetingLive(res.meeting!),
        (e: unknown) => e instanceof MeetingError && e.code === 'meeting_closed'
      );
      // A late webhook after the end must not reopen anything.
      assert.equal(
        ((await hook('participant_joined', idB, 62)) as { reason: string }).reason,
        'meeting_closed'
      );
    }
  );

  console.log('cron tick');
  const mk = async (
    title: string,
    startOffsetMin: number,
    tz = 'UTC',
    extra: { userIds?: string[]; guests?: Array<{ email: string }> } = {}
  ) => {
    const r = await svc.createMeeting(u.host, {
      organizationId: org.A,
      title,
      mode: 'scheduled',
      startAt: new Date(now.getTime() + 30 * minute).toISOString(),
      durationMinutes: 60,
      timezone: tz,
      participantUserIds: extra.userIds ?? [u.a, u.b],
      guests: extra.guests ?? [{ email: `g-${title}-${sfx}@example.test` }],
      access: 'invited',
      allowGuests: true,
    });
    await db
      .update(meetings)
      .set({
        scheduledStartAt: new Date(now.getTime() + startOffsetMin * minute),
        scheduledEndAt: new Date(now.getTime() + (startOffsetMin + 60) * minute),
      })
      .where(eq(meetings.id, r.meeting.id));
    return r.meeting.id;
  };
  const sent: Array<{ kind: string; meetingId: string; participantId: string }> = [];
  const sender = async (p: {
    kind: string;
    meeting: { id: string };
    participant: { id: string };
  }) => {
    sent.push({ kind: p.kind, meetingId: p.meeting.id, participantId: p.participant.id });
    return { status: 'sent' as const };
  };
  const tickOpts = (extra = {}) => ({
    now: new Date(),
    notificationsEnabled: true,
    sender,
    roomIdentities: async () => null,
    ...extra,
  });
  // Isolate this section: only count notifications for meetings made here.
  const ids: string[] = [];
  ids.push(
    await mk('Reminder', 20, 'Pacific/Auckland'),
    await mk('ReminderLA', 20, 'America/Los_Angeles'),
    await mk('Far', 180),
    await mk('NoShow', -35),
    await mk('NoShowEnded', -35),
    await mk('Cancelled', 20)
  );
  const [rem, remLA, far, ns, nsEnded, canc] = ids as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  await svc.cancelMeeting(canc, org.A, u.host);
  await svc.endMeeting(nsEnded, { reason: 'host_ended', at: new Date() });
  // One NoShow participant (A) did join -> must not be nudged.
  const nsA = await part(ns, u.a);
  await db
    .update(meetings)
    .set({
      status: 'live',
      actualStartedAt: new Date(now.getTime() - 34 * minute),
      livekitRoomName: `vm-ns-${sfx}`,
    })
    .where(eq(meetings.id, ns));
  await db
    .insert(meetingAttendanceSessions)
    .values({
      meetingId: ns,
      organizationId: org.A,
      participantId: nsA.id,
      identity: buildMeetingIdentity(nsA.id, 'tabnsabc'),
      joinedAt: new Date(now.getTime() - 33 * minute),
      lastSeenAt: new Date(),
    });

  const mine = new Set(ids);
  const count = (kind: string, meetingId?: string) =>
    sent.filter(
      (s) => s.kind === kind && mine.has(s.meetingId) && (!meetingId || s.meetingId === meetingId)
    ).length;

  await check('repeated and concurrent ticks never duplicate notifications', async () => {
    await Promise.all([
      runMeetingTick(tickOpts()),
      runMeetingTick(tickOpts()),
      runMeetingTick(tickOpts()),
    ]);
    for (let i = 0; i < 3; i++) await runMeetingTick(tickOpts());
    const rows = await db
      .select()
      .from(meetingNotifications)
      .where(eq(meetingNotifications.organizationId, org.A));
    const keys = rows.map(
      (r) => `${r.meetingId}|${r.participantId}|${r.kind}|${r.scheduleVersion}`
    );
    assert.equal(new Set(keys).size, keys.length, 'unique ledger');
    const sentKeys = sent
      .filter((s) => mine.has(s.meetingId))
      .map((s) => `${s.meetingId}|${s.participantId}|${s.kind}`);
    assert.equal(new Set(sentKeys).size, sentKeys.length, 'each notification delivered once');
  });
  await check(
    '30-minute reminder: in window only, same instant regardless of time zone, not for cancelled',
    async () => {
      assert.equal(count('reminder_30m', rem), 4); // host + a + b + guest
      assert.equal(count('reminder_30m', remLA), 4);
      assert.equal(count('reminder_30m', far), 0);
      assert.equal(count('reminder_30m', canc), 0);
    }
  );
  await check('invitations go to invitees (not the host), not for cancelled/ended', async () => {
    assert.equal(count('invitation', rem), 3);
    assert.equal(count('invitation', far), 3);
    assert.equal(count('invitation', canc), 0);
    assert.equal(count('invitation', nsEnded), 0);
  });
  await check(
    'no-show: only non-joined invitees of an open meeting; never for ended meetings; once',
    async () => {
      const targets = sent
        .filter((s) => s.kind === 'no_show_30m' && s.meetingId === ns)
        .map((s) => s.participantId);
      assert.ok(!targets.includes(nsA.id), 'attendee must not be nudged');
      assert.equal(targets.length, 3); // host, b, guest (a joined)
      assert.equal(count('no_show_30m', nsEnded), 0);
    }
  );
  await check('failed deliveries are retried (bounded) and then succeed', async () => {
    const mid = await mk('Retry', 20, 'UTC', { userIds: [u.a], guests: [] });
    mine.add(mid);
    let calls = 0;
    const flaky = async (p: {
      kind: string;
      meeting: { id: string };
      participant: { id: string };
    }) => {
      if (p.meeting.id !== mid || p.kind !== 'reminder_30m')
        return { status: 'skipped' as const, reason: 'n/a' };
      calls += 1;
      if (calls <= 2) throw new Error('smtp down');
      return { status: 'sent' as const };
    };
    for (let i = 0; i < 6; i++) await runMeetingTick(tickOpts({ sender: flaky }));
    const rows = await db
      .select()
      .from(meetingNotifications)
      .where(and(eq(meetingNotifications.meetingId, mid), sql`kind = 'reminder_30m'`));
    assert.ok(rows.length >= 1 && rows.every((r) => r.status === 'sent' && r.attempts <= 3));
  });
  await check(
    'without a sender implementation nothing is consumed (claims are released)',
    async () => {
      const mid = await mk('NoSender', 20, 'UTC', { userIds: [u.a], guests: [] });
      const { defaultMeetingNotificationSender } = await import(
        '../src/lib/meetings/notification-sender'
      );
      await runMeetingTick(tickOpts({ sender: defaultMeetingNotificationSender }));
      const rows = await db
        .select()
        .from(meetingNotifications)
        .where(eq(meetingNotifications.meetingId, mid));
      assert.equal(rows.length, 0);
    }
  );
  await check('notifications are off unless enabled', async () => {
    const before = sent.length;
    const r = await runMeetingTick({
      now: new Date(),
      notificationsEnabled: false,
      sender,
      roomIdentities: async () => null,
    });
    assert.equal(r.notifications, null);
    assert.equal(sent.length, before);
  });
  await check(
    "post-meeting summaries go to attendees' meeting once, only when someone attended",
    async () => {
      const before = sent.filter((s) => s.kind === 'summary').length;
      await runMeetingTick(tickOpts());
      await runMeetingTick(tickOpts());
      const summaries = sent.filter((s) => s.kind === 'summary' && s.meetingId === sc.meeting.id);
      assert.equal(summaries.length, 3); // host + a + b (c was removed pre-join)
      assert.equal(sent.filter((s) => s.kind === 'summary' && s.meetingId === nsEnded).length, 0); // nobody attended
      assert.ok(sent.filter((s) => s.kind === 'summary').length >= before);
    }
  );

  console.log('lifecycle automation');
  await check(
    'reconcile closes ghost sessions and opens missed joins (LiveKit as truth)',
    async () => {
      const mid = await mk('Reconcile', 5, 'UTC', { userIds: [u.a, u.b], guests: [] });
      const pa = await part(mid, u.a),
        pb = await part(mid, u.b);
      await db
        .update(meetings)
        .set({
          status: 'live',
          actualStartedAt: new Date(Date.now() - 10 * minute),
          livekitRoomName: `vm-rec-${sfx}`,
        })
        .where(eq(meetings.id, mid));
      const ghost = buildMeetingIdentity(pa.id, 'ghostabc');
      await db
        .insert(meetingAttendanceSessions)
        .values({
          meetingId: mid,
          organizationId: org.A,
          participantId: pa.id,
          identity: ghost,
          joinedAt: new Date(Date.now() - 5 * minute),
          lastSeenAt: new Date(),
        });
      const missed = buildMeetingIdentity(pb.id, 'missedab');
      const r = await runMeetingTick({
        now: new Date(),
        notificationsEnabled: false,
        roomIdentities: async () => new Set([missed]),
      });
      assert.ok(r.sessionsClosed >= 1 && r.sessionsOpened >= 1);
      const sess = await db
        .select()
        .from(meetingAttendanceSessions)
        .where(eq(meetingAttendanceSessions.meetingId, mid));
      assert.ok(sess.find((s) => s.identity === ghost)!.leftAt);
      assert.equal(sess.find((s) => s.identity === missed)!.leftAt, null);
    }
  );
  await check(
    'empty live room auto-ends; never-started meeting expires; stats exist for both',
    async () => {
      const empty = await mk('Empty', -20, 'UTC', { userIds: [u.a], guests: [] });
      await db
        .update(meetings)
        .set({
          status: 'live',
          actualStartedAt: new Date(Date.now() - 20 * minute),
          livekitRoomName: `vm-empty-${sfx}`,
        })
        .where(eq(meetings.id, empty));
      const stale = await mk('NeverStarted', -200, 'UTC', { userIds: [u.a], guests: [] });
      await runMeetingTick({
        now: new Date(),
        notificationsEnabled: false,
        roomIdentities: async () => new Set(),
      });
      const rows = await db
        .select()
        .from(meetings)
        .where(sql`${meetings.id} IN (${empty}, ${stale})`);
      assert.ok(rows.every((r) => r.status === 'ended'));
      assert.equal(rows.find((r) => r.id === stale)!.endReason, 'never_started');
      assert.equal(
        (
          await db
            .select()
            .from(meetingStats)
            .where(sql`${meetingStats.meetingId} IN (${empty}, ${stale})`)
        ).length,
        2
      );
    }
  );

  console.log('analytics');
  await check(
    'organization analytics are computed from rollups and isolated by organization',
    async () => {
      const q = {
        organizationId: org.A,
        from: new Date(now.getTime() - 24 * 3600_000).toISOString(),
        to: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        bucket: 'day' as const,
        timezone: 'Africa/Nairobi',
        scope: 'organization' as const,
      };
      const a = await analytics.getOrganizationMeetingAnalytics(q);
      assert.ok(a.volume.completed >= 1 && a.volume.total >= a.volume.completed);
      assert.ok(a.attendance.attended >= 2);
      assert.ok(a.attendance.attendanceRate !== null && a.attendance.noShowRate !== null);
      assert.ok(a.time.totalMeetingHours >= 1);
      assert.ok(a.participation.people.find((p) => p.userId === u.b)!.attendedSeconds >= 55 * 60);
      assert.ok(a.participation.topHosts[0]!.hosted >= 1);
      assert.ok(a.trends.length >= 1);
      const b = await analytics.getOrganizationMeetingAnalytics({ ...q, organizationId: org.B });
      assert.equal(b.volume.total, 0);
      assert.equal(b.attendance.invited, 0);
      assert.equal(b.attendance.attendanceRate, null); // unavailable, not fabricated
      assert.equal(b.participation.people.length, 0);
      const me = await analytics.getPersonalMeetingAnalytics(u.b, q);
      assert.ok(me.summary.attended >= 1 && me.summary.totalMeetingHours >= 0.9);
      const other = await analytics.getPersonalMeetingAnalytics(u.outsider, q);
      assert.equal(other.summary.invited, 0);
    }
  );

  // cleanup (cascades)
  await db.delete(meetingSeries).where(eq(meetingSeries.organizationId, org.A));
  await db.delete(organizations).where(sql`${organizations.id} IN (${org.A}, ${org.B})`);
  await db.delete(users).where(
    sql`${users.id} IN (${sql.join(
      Object.values(u).map((x) => sql`${x}`),
      sql`, `
    )})`
  );
  console.log(`\n${passed} checks passed`);
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
