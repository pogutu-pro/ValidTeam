/**
 * Notification dispatch with at-most-once claiming. A sender must first WIN the
 * unique (meeting, participant, kind, schedule_version) row — one atomic
 * INSERT .. ON CONFLICT DO UPDATE .. WHERE — so any number of concurrent or
 * repeated cron ticks produce one delivery. Failed/abandoned claims are retried
 * a bounded number of times.
 */
import {
  db,
  meetings,
  meetingParticipants,
  meetingNotifications,
  meetingStats,
  and,
  eq,
  inArray,
  isNull,
  gte,
  lte,
  sql,
  type Meeting,
  type MeetingParticipant,
} from '@validteam/db';
import { MeetingError } from './errors';
import { recordMeetingEvent } from './events';
import {
  NO_SHOW_DELAY_MS,
  NO_SHOW_MAX_AGE_MS,
  REMINDER_LEAD_MS,
  SUMMARY_MAX_AGE_MS,
  isInvitationDue,
  isNoShowDue,
  isReminderDue,
  isSummaryDue,
} from './notification-rules';
import type { MeetingNotificationKind, MeetingNotificationSender } from './notification-sender';

export const MAX_NOTIFICATION_ATTEMPTS = 3;
export const STALE_CLAIM_MINUTES = 10;

export async function claimNotification(input: {
  meeting: Pick<Meeting, 'id' | 'organizationId' | 'scheduleVersion'>;
  participantId: string;
  kind: MeetingNotificationKind;
}): Promise<string | null> {
  const [row] = await db
    .insert(meetingNotifications)
    .values({
      meetingId: input.meeting.id,
      organizationId: input.meeting.organizationId,
      participantId: input.participantId,
      kind: input.kind,
      scheduleVersion: input.meeting.scheduleVersion,
    })
    .onConflictDoUpdate({
      target: [
        meetingNotifications.meetingId,
        meetingNotifications.participantId,
        meetingNotifications.kind,
        meetingNotifications.scheduleVersion,
      ],
      set: {
        status: 'claimed',
        attempts: sql`${meetingNotifications.attempts} + 1`,
        claimedAt: sql`now()`,
        error: null,
      },
      setWhere: sql`(${meetingNotifications.status} = 'failed' AND ${meetingNotifications.attempts} < ${MAX_NOTIFICATION_ATTEMPTS})
        OR (${meetingNotifications.status} = 'claimed' AND ${meetingNotifications.claimedAt} < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}) AND ${meetingNotifications.attempts} < ${MAX_NOTIFICATION_ATTEMPTS})`,
    })
    .returning({ id: meetingNotifications.id });
  return row?.id ?? null;
}

/** Rows that are still claimable (never attempted, or retryable). */
const notYetHandled = (kind: MeetingNotificationKind) => sql`NOT EXISTS (
  SELECT 1 FROM meeting_notifications n
  WHERE n.meeting_id = ${meetings.id}
    AND n.participant_id = ${meetingParticipants.id}
    AND n.kind = ${kind}::meeting_notification_kind
    AND n.schedule_version = ${meetings.scheduleVersion}
    AND NOT (
      (n.status = 'failed' AND n.attempts < ${MAX_NOTIFICATION_ATTEMPTS})
      OR (n.status = 'claimed' AND n.attempts < ${MAX_NOTIFICATION_ATTEMPTS}
          AND n.claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
    )
)`;

type Candidate = { meeting: Meeting; participant: MeetingParticipant };

const joined = () =>
  db
    .select({ meeting: meetings, participant: meetingParticipants })
    .from(meetingParticipants)
    .innerJoin(
      meetings,
      and(
        eq(meetings.id, meetingParticipants.meetingId),
        eq(meetings.organizationId, meetingParticipants.organizationId)
      )
    );

export async function findCandidates(
  kind: MeetingNotificationKind,
  now: Date,
  limit: number
): Promise<Candidate[]> {
  const ms = (n: number) => new Date(now.getTime() + n);
  switch (kind) {
    case 'invitation':
      return joined()
        .where(
          and(
            inArray(meetings.status, ['scheduled', 'live']),
            gte(meetings.scheduledStartAt, ms(-6 * 3600_000)),
            isNull(meetingParticipants.removedAt),
            eq(meetingParticipants.role, 'participant'),
            // A series is announced once, on its first occurrence — not 60 emails.
            sql`(${meetings.seriesId} IS NULL OR ${meetings.occurrenceKey} = (
              SELECT min(m2.occurrence_key) FROM meetings m2 WHERE m2.series_id = ${meetings.seriesId}))`,
            notYetHandled(kind)
          )
        )
        .orderBy(meetings.scheduledStartAt)
        .limit(limit);
    case 'reminder_30m':
      return joined()
        .where(
          and(
            eq(meetings.status, 'scheduled'),
            eq(meetings.isInstant, false),
            gte(meetings.scheduledStartAt, now),
            lte(meetings.scheduledStartAt, ms(REMINDER_LEAD_MS)),
            isNull(meetingParticipants.removedAt),
            notYetHandled(kind)
          )
        )
        .orderBy(meetings.scheduledStartAt)
        .limit(limit);
    case 'no_show_30m':
      return joined()
        .where(
          and(
            inArray(meetings.status, ['scheduled', 'live']),
            eq(meetings.isInstant, false),
            lte(meetings.scheduledStartAt, ms(-NO_SHOW_DELAY_MS)),
            gte(meetings.scheduledStartAt, ms(-NO_SHOW_MAX_AGE_MS)),
            isNull(meetingParticipants.removedAt),
            sql`NOT EXISTS (SELECT 1 FROM meeting_attendance_sessions s WHERE s.participant_id = ${meetingParticipants.id})`,
            notYetHandled(kind)
          )
        )
        .orderBy(meetings.scheduledStartAt)
        .limit(limit);
    case 'summary':
      return joined()
        .innerJoin(meetingStats, eq(meetingStats.meetingId, meetings.id))
        .where(
          and(
            eq(meetings.status, 'ended'),
            gte(meetings.endedAt, ms(-SUMMARY_MAX_AGE_MS)),
            sql`${meetingStats.attendedCount} > 0`,
            isNull(meetingParticipants.removedAt),
            notYetHandled(kind)
          )
        )
        .orderBy(meetings.endedAt)
        .limit(limit) as unknown as Promise<Candidate[]>;
  }
}

export interface NotificationRunSummary {
  /** Candidates left for the next tick because the time budget ran out. */
  deferred: number;
  considered: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  released: number;
}

export const DEFAULT_LIMIT_PER_KIND = 50;
export const NOTIFICATION_CONCURRENCY = 4;

export async function processNotifications(opts: {
  now: Date;
  sender: MeetingNotificationSender;
  limitPerKind?: number;
  concurrency?: number;
  /** Epoch ms after which no new deliveries start (the rest wait for the next tick). */
  deadlineMs?: number;
}): Promise<Record<MeetingNotificationKind, NotificationRunSummary>> {
  const kinds: MeetingNotificationKind[] = ['invitation', 'reminder_30m', 'no_show_30m', 'summary'];
  const out = {} as Record<MeetingNotificationKind, NotificationRunSummary>;

  for (const kind of kinds) {
    const s: NotificationRunSummary = {
      deferred: 0,
      considered: 0,
      claimed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      released: 0,
    };
    out[kind] = s;
    const candidates = await findCandidates(
      kind,
      opts.now,
      opts.limitPerKind ?? DEFAULT_LIMIT_PER_KIND
    );
    const size = opts.concurrency ?? NOTIFICATION_CONCURRENCY;
    for (let i = 0; i < candidates.length; i += size) {
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
        s.deferred += candidates.length - i;
        break;
      }
      await Promise.all(candidates.slice(i, i + size).map((c) => deliverOne(kind, c, opts, s)));
    }
  }
  return out;
}

async function deliverOne(
  kind: MeetingNotificationKind,
  { meeting, participant }: Candidate,
  opts: { now: Date; sender: MeetingNotificationSender },
  s: NotificationRunSummary
): Promise<void> {
  s.considered += 1;
  const due = {
    status: meeting.status,
    isInstant: meeting.isInstant,
    scheduledStartAt: meeting.scheduledStartAt,
    endedAt: meeting.endedAt,
    hadAttendance: true,
  };
  const ok =
    kind === 'invitation'
      ? isInvitationDue(due, opts.now)
      : kind === 'reminder_30m'
        ? isReminderDue(due, opts.now)
        : kind === 'no_show_30m'
          ? isNoShowDue(due, opts.now)
          : isSummaryDue(due, opts.now);
  if (!ok) return;

  const claimId = await claimNotification({ meeting, participantId: participant.id, kind });
  if (!claimId) return;
  s.claimed += 1;

  try {
    const result = await opts.sender({ meeting, participant, kind });
    if (result.status === 'unsupported') {
      await db.delete(meetingNotifications).where(eq(meetingNotifications.id, claimId));
      s.released += 1;
    } else if (result.status === 'skipped') {
      await db
        .update(meetingNotifications)
        .set({ status: 'skipped', error: result.reason })
        .where(eq(meetingNotifications.id, claimId));
      s.skipped += 1;
    } else {
      await db
        .update(meetingNotifications)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(meetingNotifications.id, claimId));
      await recordMeetingEvent(db, {
        meetingId: meeting.id,
        organizationId: meeting.organizationId,
        participantId: participant.id,
        type: kind === 'invitation' ? 'meeting_invitation_sent' : 'notification_sent',
        data: { kind },
      });
      s.sent += 1;
    }
  } catch (error) {
    // A timeout is ambiguous (the mail may still be delivered), so it is
    // terminal: retrying could duplicate a message. Other errors retry.
    const timedOut = error instanceof MeetingError && error.code === 'email_timeout';
    await db
      .update(meetingNotifications)
      .set({
        status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        ...(timedOut ? { attempts: MAX_NOTIFICATION_ATTEMPTS } : {}),
      })
      .where(eq(meetingNotifications.id, claimId));
    s.failed += 1;
  }
}
