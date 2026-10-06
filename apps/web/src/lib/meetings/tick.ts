/**
 * Meeting cron tick (called ~every minute by the external scheduler).
 * Every step is idempotent and independently guarded, so overlapping or
 * repeated ticks are harmless:
 *  1. extend recurring series horizons          (unique occurrence key)
 *  2. reconcile open sessions against LiveKit   (closes ghosts, opens missed joins)
 *  3. auto-end empty / never-started meetings   (atomic status transition)
 *  4. backfill stats for ended meetings         (upsert)
 *  5. deliver due notifications                 (atomic claim; gated by env)
 */
import {
  db,
  meetings,
  meetingSeries,
  meetingAttendanceSessions,
  meetingStats,
  and,
  eq,
  isNull,
  lt,
  sql,
} from '@validteam/db';
import {
  endMeeting,
  computeAndPersistStats,
  materializeSeries,
  recordParticipantJoined,
  recordParticipantLeft,
  SERIES_HORIZON_DAYS,
} from './service';
import { listRoomIdentities } from './livekit-admin';
import { parseMeetingIdentity } from './livekit';
import { neverStartedDeadline } from './notification-rules';
import { processNotifications } from './notifications';
import { createMeetingEmailSender } from './email-sender';
import { meetingNotificationsEnabled, type MeetingNotificationSender } from './notification-sender';

/** A live room with nobody in it ends after this long (matches LiveKit's empty-room timeout). */
export const EMPTY_ROOM_GRACE_MS = 5 * 60_000;
/** A just-opened session is not reconciled away (webhook may still be in flight). */
export const RECONCILE_GRACE_MS = 60_000;
/** Pulse-only fallback: used only when LiveKit cannot be queried. */
export const PULSE_STALE_MS = 3 * 60_000;

export interface TickDeps {
  now?: Date;
  roomIdentities?: (roomName: string) => Promise<Set<string> | null>;
  sender?: MeetingNotificationSender;
  notificationsEnabled?: boolean;
}

export async function runMeetingTick(deps: TickDeps = {}) {
  const now = deps.now ?? new Date();
  const roomIdentities = deps.roomIdentities ?? listRoomIdentities;
  const report = {
    seriesExtended: 0,
    occurrencesCreated: 0,
    sessionsClosed: 0,
    sessionsOpened: 0,
    meetingsEnded: 0,
    statsBackfilled: 0,
    notifications: null as Awaited<ReturnType<typeof processNotifications>> | null,
    errors: [] as string[],
  };
  const guard = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await guard('series', async () => {
    const stale = await db
      .select({ id: meetingSeries.id })
      .from(meetingSeries)
      .where(
        and(
          isNull(meetingSeries.cancelledAt),
          sql`(${meetingSeries.generatedThrough} IS NULL OR ${meetingSeries.generatedThrough} < ${new Date(now.getTime() + (SERIES_HORIZON_DAYS - 7) * 86_400_000).toISOString()}::timestamptz)`
        )
      )
      .limit(50);
    for (const s of stale) {
      report.occurrencesCreated += await materializeSeries(s.id, now);
      report.seriesExtended += 1;
    }
  });

  await guard('reconcile', async () => {
    const live = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.status, 'live')))
      .limit(200);
    for (const meeting of live) {
      if (!meeting.livekitRoomName) continue;
      const present = await roomIdentities(meeting.livekitRoomName);
      const open = await db
        .select()
        .from(meetingAttendanceSessions)
        .where(
          and(
            eq(meetingAttendanceSessions.meetingId, meeting.id),
            isNull(meetingAttendanceSessions.leftAt)
          )
        );

      if (present) {
        for (const s of open) {
          if (
            !present.has(s.identity) &&
            now.getTime() - s.joinedAt.getTime() > RECONCILE_GRACE_MS
          ) {
            const r = await recordParticipantLeft({
              meetingId: meeting.id,
              identity: s.identity,
              at: now,
              reason: 'reconciled',
            });
            if (r.closed) report.sessionsClosed += 1;
          }
        }
        const openIdentities = new Set(open.map((s) => s.identity));
        for (const identity of present) {
          if (openIdentities.has(identity)) continue;
          const parsed = parseMeetingIdentity(identity);
          if (!parsed) continue;
          const r = await recordParticipantJoined({
            meetingId: meeting.id,
            participantId: parsed.participantId,
            identity,
            at: now,
            source: 'reconcile',
          });
          if (r.recorded) report.sessionsOpened += 1;
        }
      } else {
        // LiveKit unreachable: fall back to browser pulses, conservatively.
        for (const s of open) {
          if (now.getTime() - s.lastSeenAt.getTime() > PULSE_STALE_MS) {
            const r = await recordParticipantLeft({
              meetingId: meeting.id,
              identity: s.identity,
              at: s.lastSeenAt,
              reason: 'reconciled',
            });
            if (r.closed) report.sessionsClosed += 1;
          }
        }
      }
    }
  });

  await guard('auto-end', async () => {
    // Live meetings that have been empty for EMPTY_ROOM_GRACE_MS.
    const emptyBefore = new Date(now.getTime() - EMPTY_ROOM_GRACE_MS);
    const empties = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.status, 'live'),
          lt(meetings.actualStartedAt, emptyBefore),
          sql`NOT EXISTS (SELECT 1 FROM meeting_attendance_sessions s WHERE s.meeting_id = ${meetings.id}
              AND (s.left_at IS NULL OR s.left_at > ${emptyBefore.toISOString()}::timestamptz))`
        )
      )
      .limit(100);
    for (const m of empties) {
      const r = await endMeeting(m.id, { reason: 'empty_room', at: now });
      if (r.ended) report.meetingsEnded += 1;
    }

    // Scheduled meetings nobody ever opened.
    const pending = await db
      .select({
        id: meetings.id,
        scheduledStartAt: meetings.scheduledStartAt,
        scheduledEndAt: meetings.scheduledEndAt,
      })
      .from(meetings)
      .where(
        and(
          eq(meetings.status, 'scheduled'),
          lt(meetings.scheduledStartAt, new Date(now.getTime() - 30 * 60_000))
        )
      )
      .limit(200);
    for (const m of pending) {
      if (now.getTime() <= neverStartedDeadline(m).getTime()) continue;
      const r = await endMeeting(m.id, { reason: 'never_started', at: now });
      if (r.ended) report.meetingsEnded += 1;
    }
  });

  await guard('stats-backfill', async () => {
    const missing = await db
      .select({ id: meetings.id })
      .from(meetings)
      .leftJoin(meetingStats, eq(meetingStats.meetingId, meetings.id))
      .where(and(eq(meetings.status, 'ended'), isNull(meetingStats.meetingId)))
      .limit(50);
    for (const m of missing) {
      await computeAndPersistStats(m.id);
      report.statsBackfilled += 1;
    }
  });

  const enabled = deps.notificationsEnabled ?? meetingNotificationsEnabled();
  if (enabled) {
    await guard('notifications', async () => {
      report.notifications = await processNotifications({
        now,
        sender: deps.sender ?? createMeetingEmailSender(),
      });
    });
  }

  return report;
}
