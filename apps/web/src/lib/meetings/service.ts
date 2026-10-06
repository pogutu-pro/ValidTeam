/**
 * Meeting domain service: creation, scheduling, lifecycle, attendance and
 * statistics. Every query is scoped by organization (there is no RLS); the
 * lifecycle transitions are single atomic UPDATEs so concurrent webhooks, API
 * calls and cron ticks cannot double-apply them.
 */
import {
  db,
  meetings,
  meetingSeries,
  meetingParticipants,
  meetingAttendanceSessions,
  meetingGuestTokens,
  meetingStats,
  and,
  eq,
  inArray,
  isNull,
  gte,
  lt,
  sql,
  type Meeting,
  type MeetingParticipant,
} from '@validteam/db';
import { z } from 'zod';
import { MeetingError } from './errors';
import { recordMeetingEvent } from './events';
import { computeMeetingStats } from './attendance';
import { generateGuestToken, generateMeetingSlug } from './guest-tokens';
import { buildMeetingRoomName } from './livekit';
import { joinDeadline, neverStartedDeadline } from './notification-rules';
import { generateOccurrences, recurrenceRuleSchema, type RecurrenceRule } from './recurrence';
import { isValidTimeZone } from './time';
import { activeMemberIds, resolveInvitees, type ResolvedInvitees } from './participants';

export const SERIES_HORIZON_DAYS = 60;
export const DEFAULT_DURATION_MINUTES = 60;
/** Non-host participants may enter this long before the scheduled start. */
export const EARLY_JOIN_MS = 10 * 60_000;

export const createMeetingSchema = z.object({
  organizationId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  mode: z.enum(['instant', 'scheduled']).default('scheduled'),
  startAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(DEFAULT_DURATION_MINUTES),
  timezone: z
    .string()
    .refine(isValidTimeZone, { message: 'Invalid IANA time zone' })
    .default('UTC'),
  participantUserIds: z.array(z.string().min(1)).max(200).default([]),
  guests: z
    .array(z.object({ email: z.string().email().max(320), name: z.string().max(200).optional() }))
    .max(200)
    .default([]),
  recurrence: recurrenceRuleSchema.optional(),
  access: z.enum(['invited', 'organization']).default('invited'),
  allowGuests: z.boolean().default(true),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// ---------------------------------------------------------------- creation --

async function insertOccurrence(
  tx: Executor,
  base: {
    organizationId: string;
    hostId: string;
    title: string;
    description: string | null;
    isInstant: boolean;
    access: 'invited' | 'organization';
    allowGuests: boolean;
    timezone: string;
    seriesId: string | null;
    occurrenceKey: string | null;
    startAt: Date;
    endAt: Date;
  },
  invitees: ResolvedInvitees
): Promise<Meeting | null> {
  const [meeting] = await tx
    .insert(meetings)
    .values({
      slug: generateMeetingSlug(),
      organizationId: base.organizationId,
      seriesId: base.seriesId,
      occurrenceKey: base.occurrenceKey,
      hostId: base.hostId,
      title: base.title,
      description: base.description,
      isInstant: base.isInstant,
      access: base.access,
      allowGuests: base.allowGuests,
      timezone: base.timezone,
      scheduledStartAt: base.startAt,
      scheduledEndAt: base.endAt,
    })
    .onConflictDoNothing() // (series_id, occurrence_key) => idempotent materialisation
    .returning();
  if (!meeting) return null;

  await tx.insert(meetingParticipants).values([
    {
      meetingId: meeting.id,
      organizationId: base.organizationId,
      userId: base.hostId,
      role: 'host' as const,
    },
    ...invitees.userIds.map((userId) => ({
      meetingId: meeting.id,
      organizationId: base.organizationId,
      userId,
    })),
    ...invitees.guests.map((g) => ({
      meetingId: meeting.id,
      organizationId: base.organizationId,
      guestEmail: g.email,
      guestName: g.name,
    })),
  ]);
  return meeting;
}

export async function createMeeting(
  actorUserId: string,
  input: CreateMeetingInput
): Promise<{ meeting: Meeting; seriesId: string | null; occurrencesCreated: number }> {
  const now = new Date();
  const isInstant = input.mode === 'instant';
  if (isInstant && input.recurrence) {
    throw new MeetingError('invalid_request', 400, 'Instant meetings cannot recur');
  }
  if (!isInstant && !input.startAt) {
    throw new MeetingError('invalid_request', 400, 'startAt is required for scheduled meetings');
  }
  const startAt = isInstant ? now : new Date(input.startAt!);
  if (!isInstant && startAt.getTime() < now.getTime() - 5 * 60_000) {
    throw new MeetingError('invalid_request', 400, 'startAt is in the past');
  }
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);

  const invitees = await resolveInvitees({
    organizationId: input.organizationId,
    userIds: input.participantUserIds,
    guests: input.guests,
    allowGuests: input.allowGuests,
    excludeUserIds: [actorUserId],
  });

  const base = {
    organizationId: input.organizationId,
    hostId: actorUserId,
    title: input.title,
    description: input.description ?? null,
    isInstant,
    access: input.access,
    allowGuests: input.allowGuests,
    timezone: input.timezone,
  };

  return db.transaction(async (tx) => {
    if (!input.recurrence) {
      const meeting = await insertOccurrence(
        tx,
        { ...base, seriesId: null, occurrenceKey: null, startAt, endAt },
        invitees
      );
      if (!meeting) throw new MeetingError('conflict', 409, 'Could not create meeting');
      await recordMeetingEvent(tx, {
        meetingId: meeting.id,
        organizationId: meeting.organizationId,
        type: 'meeting_created',
        data: { instant: isInstant },
      });
      return { meeting, seriesId: null, occurrencesCreated: 1 };
    }

    const horizon = new Date(
      Math.max(now.getTime(), startAt.getTime()) + SERIES_HORIZON_DAYS * 86_400_000
    );
    const occurrences = generateOccurrences({
      rule: input.recurrence,
      timeZone: input.timezone,
      anchorStartAt: startAt,
      durationMinutes: input.durationMinutes,
      through: horizon,
    });
    if (occurrences.length === 0) {
      throw new MeetingError('invalid_request', 400, 'Recurrence produces no occurrences');
    }

    const [series] = await tx
      .insert(meetingSeries)
      .values({
        organizationId: input.organizationId,
        createdBy: actorUserId,
        hostId: actorUserId,
        title: input.title,
        description: input.description ?? null,
        timezone: input.timezone,
        anchorStartAt: startAt,
        durationMinutes: input.durationMinutes,
        rule: input.recurrence,
        participantTemplate: { userIds: invitees.userIds, guests: invitees.guests },
        access: input.access,
        allowGuests: input.allowGuests,
        generatedThrough: horizon,
      })
      .returning();

    let first: Meeting | null = null;
    let created = 0;
    for (const occ of occurrences) {
      const m = await insertOccurrence(
        tx,
        {
          ...base,
          seriesId: series!.id,
          occurrenceKey: occ.key,
          startAt: occ.startAt,
          endAt: occ.endAt,
        },
        invitees
      );
      if (m) {
        created += 1;
        first ??= m;
      }
    }
    await recordMeetingEvent(tx, {
      meetingId: first!.id,
      organizationId: input.organizationId,
      type: 'meeting_created',
      data: { seriesId: series!.id, occurrences: created },
    });
    return { meeting: first!, seriesId: series!.id, occurrencesCreated: created };
  });
}

/**
 * Extend a series' materialised horizon. Safe to run concurrently / repeatedly:
 * (series_id, occurrence_key) is unique and inserts are ON CONFLICT DO NOTHING.
 */
export async function materializeSeries(seriesId: string, now: Date = new Date()): Promise<number> {
  const [series] = await db
    .select()
    .from(meetingSeries)
    .where(eq(meetingSeries.id, seriesId))
    .limit(1);
  if (!series || series.cancelledAt) return 0;

  const horizon = new Date(now.getTime() + SERIES_HORIZON_DAYS * 86_400_000);
  const rule = recurrenceRuleSchema.parse(series.rule);
  const occurrences = generateOccurrences({
    rule,
    timeZone: series.timezone,
    anchorStartAt: series.anchorStartAt,
    durationMinutes: series.durationMinutes,
    from: new Date(Math.max(series.anchorStartAt.getTime(), now.getTime() - 86_400_000)),
    through: horizon,
  });

  const template = z
    .object({
      userIds: z.array(z.string()).default([]),
      guests: z.array(z.object({ email: z.string(), name: z.string().nullable() })).default([]),
    })
    .parse(series.participantTemplate);
  // Membership may have changed since the series was created.
  const valid = await activeMemberIds(series.organizationId, template.userIds);
  const invitees: ResolvedInvitees = {
    userIds: template.userIds.filter((id) => valid.has(id) && id !== series.hostId),
    guests: template.guests,
  };

  let created = 0;
  for (const occ of occurrences) {
    const inserted = await db.transaction((tx) =>
      insertOccurrence(
        tx,
        {
          organizationId: series.organizationId,
          hostId: series.hostId,
          title: series.title,
          description: series.description,
          isInstant: false,
          access: series.access,
          allowGuests: series.allowGuests,
          timezone: series.timezone,
          seriesId: series.id,
          occurrenceKey: occ.key,
          startAt: occ.startAt,
          endAt: occ.endAt,
        },
        invitees
      )
    );
    if (inserted) created += 1;
  }
  await db
    .update(meetingSeries)
    .set({ generatedThrough: horizon, updatedAt: now })
    .where(eq(meetingSeries.id, series.id));
  return created;
}

// ------------------------------------------------------------------ lookup --

export async function getMeetingBySlug(slug: string): Promise<Meeting | null> {
  const [m] = await db.select().from(meetings).where(eq(meetings.slug, slug)).limit(1);
  return m ?? null;
}

// --------------------------------------------------------------- lifecycle --

/** scheduled -> live, assigning the LiveKit room once. Returns the live meeting row. */
export async function ensureMeetingLive(
  meeting: Meeting,
  now: Date = new Date()
): Promise<Meeting> {
  if (meeting.status === 'live' && meeting.livekitRoomName) return meeting;

  const [started] = await db
    .update(meetings)
    .set({
      status: 'live',
      actualStartedAt: now,
      livekitRoomName: buildMeetingRoomName(),
      updatedAt: now,
    })
    .where(
      and(
        eq(meetings.id, meeting.id),
        eq(meetings.organizationId, meeting.organizationId),
        eq(meetings.status, 'scheduled')
      )
    )
    .returning();
  if (started) {
    await recordMeetingEvent(db, {
      meetingId: started.id,
      organizationId: started.organizationId,
      type: 'meeting_started',
      occurredAt: now,
    });
    return started;
  }

  const [current] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meeting.id), eq(meetings.organizationId, meeting.organizationId)))
    .limit(1);
  if (!current || current.status === 'ended' || current.status === 'cancelled') {
    throw new MeetingError('meeting_closed', 410, 'This meeting is no longer open');
  }
  if (!current.livekitRoomName) {
    // live without a room can only happen via manual repair; assign one atomically.
    const [fixed] = await db
      .update(meetings)
      .set({ livekitRoomName: buildMeetingRoomName(), updatedAt: now })
      .where(and(eq(meetings.id, current.id), isNull(meetings.livekitRoomName)))
      .returning();
    if (fixed) return fixed;
    const [again] = await db.select().from(meetings).where(eq(meetings.id, current.id)).limit(1);
    return again!;
  }
  return current;
}

export function assertJoinable(
  meeting: Pick<Meeting, 'status' | 'scheduledStartAt' | 'scheduledEndAt'>,
  opts: { isHost: boolean; now?: Date }
): void {
  const now = opts.now ?? new Date();
  if (meeting.status === 'cancelled')
    throw new MeetingError('meeting_cancelled', 410, 'This meeting was cancelled');
  if (meeting.status === 'ended')
    throw new MeetingError('meeting_ended', 410, 'This meeting has ended');
  if (meeting.status === 'live') return;
  if (now.getTime() > joinDeadline(meeting).getTime()) {
    throw new MeetingError('meeting_expired', 410, 'This meeting window has passed');
  }
  if (!opts.isHost && now.getTime() < meeting.scheduledStartAt.getTime() - EARLY_JOIN_MS) {
    throw new MeetingError('too_early', 425, 'This meeting has not opened yet', {
      opensAt: new Date(meeting.scheduledStartAt.getTime() - EARLY_JOIN_MS).toISOString(),
    });
  }
}

/**
 * End a meeting exactly once: close every open session at `at`, compute stats.
 * Returns false when it was already ended/cancelled (idempotent).
 */
export async function endMeeting(
  meetingId: string,
  opts: { by?: string | null; reason: string; at?: Date }
): Promise<{ ended: boolean; meeting: Meeting | null }> {
  const at = opts.at ?? new Date();
  const ended = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(meetings)
      .set({
        status: 'ended',
        endedAt: at,
        endedBy: opts.by ?? null,
        endReason: opts.reason,
        updatedAt: at,
      })
      .where(and(eq(meetings.id, meetingId), inArray(meetings.status, ['scheduled', 'live'])))
      .returning();
    if (!row) return null;

    await tx
      .update(meetingAttendanceSessions)
      .set({
        // never earlier than join (clock skew safe)
        leftAt: sql`GREATEST(${at.toISOString()}::timestamptz, ${meetingAttendanceSessions.joinedAt})`,
        leaveReason: 'meeting_ended',
      })
      .where(
        and(
          eq(meetingAttendanceSessions.meetingId, meetingId),
          isNull(meetingAttendanceSessions.leftAt)
        )
      );

    await recordMeetingEvent(tx, {
      meetingId,
      organizationId: row.organizationId,
      type: 'meeting_ended',
      occurredAt: at,
      data: { reason: opts.reason },
    });
    return row;
  });
  if (!ended) return { ended: false, meeting: null };
  await computeAndPersistStats(meetingId);
  return { ended: true, meeting: ended };
}

export async function cancelMeeting(
  meetingId: string,
  organizationId: string,
  by: string
): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(meetings)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(meetings.id, meetingId),
        eq(meetings.organizationId, organizationId),
        eq(meetings.status, 'scheduled')
      )
    )
    .returning();
  if (!row) return false;
  await recordMeetingEvent(db, {
    meetingId,
    organizationId,
    type: 'meeting_cancelled',
    data: { by },
  });
  return true;
}

/** Cancel a series and every not-yet-started occurrence of it. */
export async function cancelSeries(
  seriesId: string,
  organizationId: string,
  by: string
): Promise<number> {
  const now = new Date();
  const [series] = await db
    .update(meetingSeries)
    .set({ cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(meetingSeries.id, seriesId),
        eq(meetingSeries.organizationId, organizationId),
        isNull(meetingSeries.cancelledAt)
      )
    )
    .returning();
  if (!series) return 0;
  const cancelled = await db
    .update(meetings)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(meetings.seriesId, seriesId),
        eq(meetings.organizationId, organizationId),
        eq(meetings.status, 'scheduled'),
        gte(meetings.scheduledStartAt, now)
      )
    )
    .returning({ id: meetings.id });
  for (const c of cancelled) {
    await recordMeetingEvent(db, {
      meetingId: c.id,
      organizationId,
      type: 'meeting_cancelled',
      data: { by, series: true },
    });
  }
  return cancelled.length;
}

export async function rescheduleMeeting(
  meeting: Meeting,
  input: { startAt: Date; durationMinutes?: number }
): Promise<Meeting> {
  if (meeting.status !== 'scheduled') {
    throw new MeetingError('invalid_state', 409, 'Only scheduled meetings can be rescheduled');
  }
  const duration =
    input.durationMinutes ??
    Math.round((meeting.scheduledEndAt.getTime() - meeting.scheduledStartAt.getTime()) / 60_000);
  const [row] = await db
    .update(meetings)
    .set({
      scheduledStartAt: input.startAt,
      scheduledEndAt: new Date(input.startAt.getTime() + duration * 60_000),
      scheduleVersion: sql`${meetings.scheduleVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meeting.id),
        eq(meetings.organizationId, meeting.organizationId),
        eq(meetings.status, 'scheduled')
      )
    )
    .returning();
  if (!row) throw new MeetingError('invalid_state', 409, 'Meeting changed state');
  return row;
}

// -------------------------------------------------------------- attendance --

export type JoinRecordResult =
  | { recorded: true; rejoin: boolean }
  | {
      recorded: false;
      reason: 'duplicate' | 'participant_not_found' | 'participant_removed' | 'meeting_closed';
    };

/** Open an attendance session. Duplicate webhooks hit the partial unique index and no-op. */
export async function recordParticipantJoined(input: {
  meetingId: string;
  participantId: string;
  identity: string;
  at: Date;
  source?: 'webhook' | 'reconcile' | 'pulse';
}): Promise<JoinRecordResult> {
  const [row] = await db
    .select({
      meeting: meetings,
      participant: meetingParticipants,
    })
    .from(meetingParticipants)
    .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
    .where(
      and(
        eq(meetingParticipants.id, input.participantId),
        eq(meetingParticipants.meetingId, input.meetingId)
      )
    )
    .limit(1);
  if (!row) return { recorded: false, reason: 'participant_not_found' };
  if (row.participant.removedAt) return { recorded: false, reason: 'participant_removed' };
  if (row.meeting.status === 'ended' || row.meeting.status === 'cancelled') {
    return { recorded: false, reason: 'meeting_closed' };
  }

  return db.transaction(async (tx) => {
    const prior = await tx
      .select({ id: meetingAttendanceSessions.id })
      .from(meetingAttendanceSessions)
      .where(
        and(
          eq(meetingAttendanceSessions.meetingId, input.meetingId),
          eq(meetingAttendanceSessions.participantId, input.participantId)
        )
      )
      .limit(1);

    const [inserted] = await tx
      .insert(meetingAttendanceSessions)
      .values({
        meetingId: input.meetingId,
        organizationId: row.meeting.organizationId,
        participantId: input.participantId,
        identity: input.identity,
        joinedAt: input.at,
        source: input.source ?? 'webhook',
        lastSeenAt: input.at,
      })
      .onConflictDoNothing()
      .returning({ id: meetingAttendanceSessions.id });
    if (!inserted) return { recorded: false as const, reason: 'duplicate' as const };

    if (row.meeting.status === 'scheduled') {
      await tx
        .update(meetings)
        .set({
          status: 'live',
          actualStartedAt: input.at,
          livekitRoomName: row.meeting.livekitRoomName ?? buildMeetingRoomName(),
          updatedAt: input.at,
        })
        .where(and(eq(meetings.id, input.meetingId), eq(meetings.status, 'scheduled')));
    }
    const rejoin = prior.length > 0;
    await recordMeetingEvent(tx, {
      meetingId: input.meetingId,
      organizationId: row.meeting.organizationId,
      participantId: input.participantId,
      type: rejoin ? 'participant_rejoined' : 'participant_joined',
      occurredAt: input.at,
    });
    return { recorded: true as const, rejoin };
  });
}

export async function recordParticipantLeft(input: {
  meetingId: string;
  identity: string;
  at: Date;
  reason: 'left' | 'disconnected' | 'removed' | 'reconciled';
}): Promise<{ closed: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(meetingAttendanceSessions)
      .set({
        leftAt: sql`GREATEST(${input.at.toISOString()}::timestamptz, ${meetingAttendanceSessions.joinedAt})`,
        leaveReason: input.reason,
      })
      .where(
        and(
          eq(meetingAttendanceSessions.meetingId, input.meetingId),
          eq(meetingAttendanceSessions.identity, input.identity),
          isNull(meetingAttendanceSessions.leftAt)
        )
      )
      .returning();
    if (!row) return { closed: false };
    await recordMeetingEvent(tx, {
      meetingId: input.meetingId,
      organizationId: row.organizationId,
      participantId: row.participantId,
      type: 'participant_left',
      occurredAt: input.at,
      data: { reason: input.reason },
    });
    return { closed: true };
  });
}

/** Browser keep-alive: only used to age out sessions when LiveKit cannot be queried. */
export async function recordPulse(
  meetingId: string,
  participantId: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(meetingAttendanceSessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(meetingAttendanceSessions.meetingId, meetingId),
        eq(meetingAttendanceSessions.participantId, participantId),
        isNull(meetingAttendanceSessions.leftAt)
      )
    );
}

// ------------------------------------------------------------------- stats --

export async function computeAndPersistStats(meetingId: string): Promise<void> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting || meeting.status !== 'ended' || !meeting.endedAt) return;

  const [allParticipants, sessions] = await Promise.all([
    db
      .select()
      .from(meetingParticipants)
      .where(
        and(
          eq(meetingParticipants.meetingId, meetingId),
          eq(meetingParticipants.organizationId, meeting.organizationId)
        )
      ),
    db
      .select()
      .from(meetingAttendanceSessions)
      .where(
        and(
          eq(meetingAttendanceSessions.meetingId, meetingId),
          eq(meetingAttendanceSessions.organizationId, meeting.organizationId)
        )
      ),
  ]);
  const attendedIds = new Set(sessions.map((s) => s.participantId));
  // Someone removed before ever joining is not an "invitee who failed to show".
  const counted = allParticipants.filter((p) => !p.removedAt || attendedIds.has(p.id));

  const stats = computeMeetingStats({
    window: {
      scheduledStartAt: meeting.scheduledStartAt,
      isInstant: meeting.isInstant,
      endedAt: meeting.endedAt,
    },
    participants: counted.map((p) => ({ id: p.id, userId: p.userId })),
    sessions: sessions.map((s) => ({
      participantId: s.participantId,
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
    })),
  });
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const p of stats.participants) {
      await tx
        .update(meetingParticipants)
        .set({
          statsComputedAt: now,
          firstJoinedAt: p.firstJoinedAt,
          lastLeftAt: p.lastLeftAt,
          attendedSeconds: p.attendedSeconds,
          attendancePct: p.attendancePct,
          joinCount: p.joinCount,
          leaveCount: p.leaveCount,
          lateArrival: p.lateArrival,
          earlyDeparture: p.earlyDeparture,
          noShow: p.noShow,
        })
        .where(
          and(
            eq(meetingParticipants.id, p.participantId),
            eq(meetingParticipants.meetingId, meetingId)
          )
        );
    }
    const values = {
      organizationId: meeting.organizationId,
      hostId: meeting.hostId,
      isRecurring: meeting.seriesId !== null,
      hasExternalGuests: counted.some((p) => p.guestEmail !== null),
      startedAt: stats.startedAt,
      endedAt: stats.endedAt,
      scheduledStartAt: meeting.scheduledStartAt,
      durationSeconds: stats.durationSeconds,
      invitedCount: stats.invitedCount,
      attendedCount: stats.attendedCount,
      noShowCount: stats.noShowCount,
      peakConcurrent: stats.peakConcurrent,
      totalParticipantSeconds: stats.totalParticipantSeconds,
      avgAttendanceSeconds: stats.avgAttendanceSeconds,
      avgAttendancePct: stats.avgAttendancePct,
      lateArrivals: stats.lateArrivals,
      earlyDepartures: stats.earlyDepartures,
      totalJoins: stats.totalJoins,
      totalLeaves: stats.totalLeaves,
      computedAt: now,
    };
    const inserted = await tx
      .insert(meetingStats)
      .values({ meetingId, ...values })
      .onConflictDoUpdate({ target: meetingStats.meetingId, set: values })
      .returning({ computedAt: meetingStats.computedAt });
    if (inserted.length) {
      // No-show detection is final once the meeting is over.
      for (const p of stats.participants.filter((x) => x.noShow)) {
        await recordMeetingEvent(tx, {
          meetingId,
          organizationId: meeting.organizationId,
          participantId: p.participantId,
          type: 'no_show_detected',
          occurredAt: now,
        });
      }
      await recordMeetingEvent(tx, {
        meetingId,
        organizationId: meeting.organizationId,
        type: 'meeting_summary_generated',
        occurredAt: now,
      });
    }
  });
}

// ------------------------------------------------------------ participants --

export async function addParticipants(
  meeting: Meeting,
  input: { userIds: string[]; guests: Array<{ email: string; name?: string | undefined }> }
): Promise<{ added: number }> {
  if (meeting.status === 'ended' || meeting.status === 'cancelled') {
    throw new MeetingError('invalid_state', 409, 'Meeting is closed');
  }
  const invitees = await resolveInvitees({
    organizationId: meeting.organizationId,
    userIds: input.userIds,
    guests: input.guests,
    allowGuests: meeting.allowGuests,
  });
  const existing = await db
    .select({ id: meetingParticipants.id })
    .from(meetingParticipants)
    .where(eq(meetingParticipants.meetingId, meeting.id));
  if (existing.length + invitees.userIds.length + invitees.guests.length > 200) {
    throw new MeetingError('too_many_participants', 400, 'At most 200 participants');
  }
  const rows = [
    ...invitees.userIds.map((userId) => ({
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      userId,
    })),
    ...invitees.guests.map((g) => ({
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      guestEmail: g.email,
      guestName: g.name,
    })),
  ];
  if (!rows.length) return { added: 0 };
  const inserted = await db
    .insert(meetingParticipants)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: meetingParticipants.id });
  return { added: inserted.length };
}

export async function listParticipants(
  meeting: Pick<Meeting, 'id' | 'organizationId'>
): Promise<MeetingParticipant[]> {
  return db
    .select()
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.organizationId, meeting.organizationId)
      )
    );
}

/** Soft-remove: blocks rejoin, revokes guest tokens, closes open sessions. Returns open identities to kick. */
export async function removeParticipant(
  meeting: Meeting,
  participantId: string,
  by: string
): Promise<{ removed: boolean; openIdentities: string[] }> {
  return db.transaction(async (tx) => {
    const [p] = await tx
      .update(meetingParticipants)
      .set({ removedAt: new Date(), removedBy: by })
      .where(
        and(
          eq(meetingParticipants.id, participantId),
          eq(meetingParticipants.meetingId, meeting.id),
          eq(meetingParticipants.organizationId, meeting.organizationId),
          eq(meetingParticipants.role, 'participant'), // the host cannot be removed
          isNull(meetingParticipants.removedAt)
        )
      )
      .returning();
    if (!p) return { removed: false, openIdentities: [] };
    await tx
      .update(meetingGuestTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(meetingGuestTokens.participantId, participantId),
          isNull(meetingGuestTokens.revokedAt)
        )
      );
    const closed = await tx
      .update(meetingAttendanceSessions)
      .set({
        leftAt: sql`GREATEST(now(), ${meetingAttendanceSessions.joinedAt})`,
        leaveReason: 'removed',
      })
      .where(
        and(
          eq(meetingAttendanceSessions.participantId, participantId),
          isNull(meetingAttendanceSessions.leftAt)
        )
      )
      .returning({ identity: meetingAttendanceSessions.identity });
    await recordMeetingEvent(tx, {
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      participantId,
      type: 'participant_removed',
      data: { by },
    });
    return { removed: true, openIdentities: closed.map((c) => c.identity) };
  });
}

// ------------------------------------------------------------ guest tokens --

/** Mint a fresh guest link token (hash stored, raw returned once). */
export async function issueGuestToken(meeting: Meeting, participantId: string): Promise<string> {
  const { token, tokenHash } = generateGuestToken();
  await db.insert(meetingGuestTokens).values({
    meetingId: meeting.id,
    participantId,
    tokenHash,
    expiresAt: joinDeadline(meeting),
  });
  return token;
}

export async function findOpenSessionCount(meetingId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingAttendanceSessions)
    .where(
      and(
        eq(meetingAttendanceSessions.meetingId, meetingId),
        isNull(meetingAttendanceSessions.leftAt)
      )
    );
  return r?.n ?? 0;
}

export type { RecurrenceRule };

// ------------------------------------------------- self-healing lifecycle --

/** A live room with nobody in it ends after this long (matches LiveKit's empty-room timeout). */
export const EMPTY_ROOM_GRACE_MS = 5 * 60_000;

/**
 * Close out meetings that are over: live rooms that have been empty for
 * EMPTY_ROOM_GRACE_MS, and scheduled meetings nobody ever opened. Idempotent
 * (atomic status transition) and safe to call from request handlers, so
 * analytics stay correct even when the cron tick or LiveKit webhooks are not
 * running. The cron tick calls the same function with no organization filter.
 */
export async function autoEndMeetings(opts: {
  now?: Date;
  organizationId?: string;
  limit?: number;
}): Promise<number> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 100;
  const org = opts.organizationId ? eq(meetings.organizationId, opts.organizationId) : undefined;
  let ended = 0;

  const emptyBefore = new Date(now.getTime() - EMPTY_ROOM_GRACE_MS);
  const empties = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        org,
        eq(meetings.status, 'live'),
        lt(meetings.actualStartedAt, emptyBefore),
        sql`NOT EXISTS (SELECT 1 FROM meeting_attendance_sessions s WHERE s.meeting_id = ${meetings.id}
            AND (s.left_at IS NULL OR s.left_at > ${emptyBefore.toISOString()}::timestamptz))`
      )
    )
    .limit(limit);
  for (const m of empties) {
    if ((await endMeeting(m.id, { reason: 'empty_room', at: now })).ended) ended += 1;
  }

  const pending = await db
    .select({
      id: meetings.id,
      scheduledStartAt: meetings.scheduledStartAt,
      scheduledEndAt: meetings.scheduledEndAt,
    })
    .from(meetings)
    .where(
      and(
        org,
        eq(meetings.status, 'scheduled'),
        lt(meetings.scheduledStartAt, new Date(now.getTime() - 30 * 60_000))
      )
    )
    .limit(limit * 2);
  for (const m of pending) {
    if (now.getTime() <= neverStartedDeadline(m).getTime()) continue;
    if ((await endMeeting(m.id, { reason: 'never_started', at: now })).ended) ended += 1;
  }
  return ended;
}

/** Best-effort sweep used by read endpoints; never fails the request. */
export async function sweepOrganizationMeetings(organizationId: string): Promise<void> {
  try {
    const ended = await autoEndMeetings({ organizationId, limit: 25 });
    if (ended > 0) {
      // Post-meeting summaries go out now, not whenever the scheduler next runs.
      const { dispatchSummaries } = await import('./dispatch');
      const { runAfterResponse } = await import('./background');
      runAfterResponse('summary dispatch', () => dispatchSummaries({ organizationId }));
    }
  } catch (error) {
    console.error('[meetings] sweep failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Browser heartbeat. Besides refreshing `last_seen_at`, it OPENS the session if
 * LiveKit's join webhook never arrived (misconfigured webhook URL, outage):
 * the identity is derived server-side from the authenticated participant, so
 * a client can only ever record attendance for itself.
 */
export async function recordPulseWithSession(
  meeting: Pick<Meeting, 'id' | 'status'>,
  participantId: string,
  identity: string | null,
  now: Date = new Date()
): Promise<void> {
  if (identity && meeting.status === 'live') {
    await recordParticipantJoined({
      meetingId: meeting.id,
      participantId,
      identity,
      at: now,
      source: 'pulse',
    });
  }
  await recordPulse(meeting.id, participantId, now);
}
