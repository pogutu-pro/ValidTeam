/**
 * Delivers meeting notifications through the existing SMTP pipeline
 * (`sendEmail`: Admin → System SMTP config, then env). Idempotency is handled
 * by the claim ledger in ./notifications; this module only renders and sends.
 *
 * Privacy: guests receive only their own attendance and aggregate counts; the
 * named attendance overview is limited to internal members.
 */
import {
  db,
  meetingParticipants,
  meetingSeries,
  meetingStats,
  notificationPreferences,
  organizations,
  users,
  and,
  eq,
} from '@validteam/db';
import {
  sendEmail as defaultSend,
  type SendEmailParams,
  type SendEmailResult,
} from '@/lib/email/sender';
import { MeetingError } from './errors';
import { buildIcs, googleCalendarUrl } from './ics';
import {
  buildInvitationEmail,
  buildNoShowEmail,
  buildReminderEmail,
  buildSummaryEmail,
  type BuiltEmail,
  type MeetingEmailCtx,
} from './emails';
import { recurrenceRuleSchema } from './recurrence';
import { issueGuestToken } from './service';
import { isValidTimeZone } from './time';
import type { MeetingNotificationKind, MeetingNotificationSender } from './notification-sender';

const PREF_FIELD = {
  invitation: 'emailOnMeetingInvite',
  reminder_30m: 'emailOnMeetingReminder',
  no_show_30m: 'emailOnMeetingNoShow',
  summary: 'emailOnMeetingSummary',
} as const satisfies Record<
  MeetingNotificationKind,
  keyof typeof notificationPreferences.$inferSelect
>;

/** Upper bound for one SMTP delivery so a slow server can never stall the tick. */
export const EMAIL_SEND_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new MeetingError('email_timeout', 504, `Email delivery timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function createMeetingEmailSender(
  deps: {
    send?: (p: SendEmailParams) => Promise<SendEmailResult>;
    appUrl?: string;
    timeoutMs?: number;
  } = {}
): MeetingNotificationSender {
  const send = deps.send ?? defaultSend;

  return async ({ meeting, participant, kind }) => {
    const appUrl = deps.appUrl ?? appBaseUrl();

    const [[org], [host], member] = await Promise.all([
      db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, meeting.organizationId))
        .limit(1),
      db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, meeting.hostId))
        .limit(1),
      participant.userId
        ? db
            .select({
              name: users.name,
              email: users.email,
              timezone: users.timezone,
              status: users.status,
            })
            .from(users)
            .where(eq(users.id, participant.userId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const isGuest = participant.userId === null;
    const to = isGuest ? participant.guestEmail : member?.email;
    if (!to) return { status: 'skipped', reason: 'no_recipient' };
    if (member && member.status !== 'active') return { status: 'skipped', reason: 'inactive_user' };

    if (member && participant.userId) {
      const [prefs] = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, participant.userId),
            eq(notificationPreferences.organizationId, meeting.organizationId)
          )
        )
        .limit(1);
      if (prefs && (!prefs.enableEmail || prefs[PREF_FIELD[kind]] === false)) {
        return { status: 'skipped', reason: 'preferences' };
      }
    }

    const recipientZone =
      member?.timezone && isValidTimeZone(member.timezone) ? member.timezone : meeting.timezone;
    const baseJoin = `${appUrl}/meet/${meeting.slug}`;
    // Guest links carry a freshly minted, hashed-at-rest, expiring token.
    const joinUrl = isGuest
      ? `${baseJoin}?g=${await issueGuestToken(meeting, participant.id)}`
      : baseJoin;

    const ctx: MeetingEmailCtx = {
      title: meeting.title,
      hostName: host?.name?.trim() || host?.email || 'A teammate',
      organizationName: org?.name ?? 'ValidTeam',
      start: meeting.scheduledStartAt,
      end: meeting.scheduledEndAt,
      timeZone: recipientZone,
      joinUrl,
      isGuest,
      isSeries: meeting.seriesId !== null,
      recipientName: isGuest ? participant.guestName : member?.name,
    };

    let email: BuiltEmail;
    let attachments: SendEmailParams['attachments'];

    if (kind === 'invitation') {
      const calendarUrl = googleCalendarUrl({
        title: meeting.title,
        description: meeting.description,
        url: joinUrl,
        start: meeting.scheduledStartAt,
        end: meeting.scheduledEndAt,
      });
      email = buildInvitationEmail({ ...ctx, calendarUrl }, appUrl);
      let recurrence: {
        rule: ReturnType<typeof recurrenceRuleSchema.parse>;
        timezone: string;
      } | null = null;
      if (meeting.seriesId) {
        const [series] = await db
          .select({ rule: meetingSeries.rule, timezone: meetingSeries.timezone })
          .from(meetingSeries)
          .where(eq(meetingSeries.id, meeting.seriesId))
          .limit(1);
        const parsed = series ? recurrenceRuleSchema.safeParse(series.rule) : null;
        if (series && parsed?.success)
          recurrence = { rule: parsed.data, timezone: series.timezone };
      }
      attachments = [
        {
          filename: 'invite.ics',
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          content: buildIcs({
            uid: meeting.seriesId ?? meeting.id,
            title: meeting.title,
            description: meeting.description,
            url: joinUrl,
            start: meeting.scheduledStartAt,
            end: meeting.scheduledEndAt,
            organizerName: ctx.hostName,
            attendeeEmail: to,
            recurrence,
          }),
        },
      ];
    } else if (kind === 'reminder_30m') {
      email = buildReminderEmail(ctx, appUrl);
    } else if (kind === 'no_show_30m') {
      email = buildNoShowEmail(ctx, appUrl);
    } else {
      const [stats] = await db
        .select()
        .from(meetingStats)
        .where(
          and(
            eq(meetingStats.meetingId, meeting.id),
            eq(meetingStats.organizationId, meeting.organizationId)
          )
        )
        .limit(1);
      if (!stats || stats.attendedCount === 0)
        return { status: 'skipped', reason: 'no_attendance' };

      let roster: Array<{
        name: string;
        attended: boolean;
        attendedSeconds: number | null;
      }> | null = null;
      if (!isGuest) {
        const rows = await db
          .select({ p: meetingParticipants, name: users.name, email: users.email })
          .from(meetingParticipants)
          .leftJoin(users, eq(users.id, meetingParticipants.userId))
          .where(
            and(
              eq(meetingParticipants.meetingId, meeting.id),
              eq(meetingParticipants.organizationId, meeting.organizationId)
            )
          );
        roster = rows
          .filter(({ p }) => p.statsComputedAt)
          .map(({ p, name, email }) => ({
            name: (p.userId ? name?.trim() || email : p.guestName) || 'Guest',
            attended: p.noShow === false,
            attendedSeconds: p.attendedSeconds,
          }))
          .sort((a, b) => Number(b.attended) - Number(a.attended) || a.name.localeCompare(b.name));
      }
      email = buildSummaryEmail(
        ctx,
        {
          durationSeconds: stats.durationSeconds,
          invited: stats.invitedCount,
          attended: stats.attendedCount,
          noShows: stats.noShowCount,
          peak: stats.peakConcurrent,
          avgAttendancePct: stats.avgAttendancePct,
          lateArrivals: stats.lateArrivals,
          earlyDepartures: stats.earlyDepartures,
          you: {
            noShow: participant.noShow !== false,
            firstJoinedAt: participant.firstJoinedAt,
            lastLeftAt: participant.lastLeftAt,
            attendedSeconds: participant.attendedSeconds,
            attendancePct: participant.attendancePct,
          },
          roster,
          analyticsUrl: isGuest ? null : `${appUrl}/meetings/${meeting.slug}`,
        },
        appUrl
      );
    }

    const result = await withTimeout(
      send({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(attachments ? { attachments } : {}),
      }),
      deps.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS
    );
    if (result.sent) return { status: 'sent' };
    if (result.skipped) return { status: 'skipped', reason: 'smtp_not_configured' };
    throw new MeetingError('email_failed', 502, result.error ?? 'Email delivery failed');
  };
}
