/**
 * When each meeting notification becomes due. Pure so the cron tick and the
 * tests share one definition. Windows are bounded on BOTH sides so a late or
 * restarted cron never sends stale mail ("starts in 30 minutes" after start).
 */
export const REMINDER_LEAD_MS = 30 * 60_000;
export const NO_SHOW_DELAY_MS = 30 * 60_000;
/** Do not send a no-show nudge later than this after the scheduled start. */
export const NO_SHOW_MAX_AGE_MS = 3 * 60 * 60_000;
/** Do not send a summary for meetings that ended longer ago than this. */
export const SUMMARY_MAX_AGE_MS = 24 * 60 * 60_000;

export type MeetingStatusValue = 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface NotifiableMeeting {
  status: MeetingStatusValue;
  isInstant: boolean;
  scheduledStartAt: Date;
  endedAt: Date | null;
  /** True when someone actually attended (summary is pointless otherwise). */
  hadAttendance?: boolean;
}

export function isInvitationDue(m: NotifiableMeeting, now: Date): boolean {
  if (m.status === 'cancelled' || m.status === 'ended') return false;
  // Instant meetings are invitations to "now"; keep them valid for 6 hours.
  return now.getTime() <= m.scheduledStartAt.getTime() + 6 * 60 * 60_000;
}

export function isReminderDue(m: NotifiableMeeting, now: Date): boolean {
  if (m.isInstant || m.status !== 'scheduled') return false;
  const t = now.getTime();
  const start = m.scheduledStartAt.getTime();
  return t >= start - REMINDER_LEAD_MS && t < start;
}

/** Only for participants with no attendance session; the caller filters those. */
export function isNoShowDue(m: NotifiableMeeting, now: Date): boolean {
  if (m.isInstant) return false;
  // Ended/cancelled meetings must not claim to be "still active".
  if (m.status !== 'scheduled' && m.status !== 'live') return false;
  const t = now.getTime();
  const start = m.scheduledStartAt.getTime();
  return t >= start + NO_SHOW_DELAY_MS && t <= start + NO_SHOW_MAX_AGE_MS;
}

export function isSummaryDue(m: NotifiableMeeting, now: Date): boolean {
  if (m.status !== 'ended' || !m.endedAt || m.hadAttendance === false) return false;
  return now.getTime() - m.endedAt.getTime() <= SUMMARY_MAX_AGE_MS;
}

/** A scheduled meeting nobody opened becomes 'ended' after this. */
export function neverStartedDeadline(m: { scheduledStartAt: Date; scheduledEndAt: Date }): Date {
  const minDuration = m.scheduledStartAt.getTime() + 30 * 60_000;
  return new Date(Math.max(m.scheduledEndAt.getTime(), minDuration) + 30 * 60_000);
}

/** Last instant a participant may still join (also the guest token expiry). */
export function joinDeadline(m: { scheduledStartAt: Date; scheduledEndAt: Date }): Date {
  return neverStartedDeadline(m);
}
