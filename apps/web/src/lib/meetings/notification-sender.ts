import type { Meeting, MeetingParticipant } from '@validteam/db';

export type MeetingNotificationKind = 'invitation' | 'reminder_30m' | 'no_show_30m' | 'summary';

export interface MeetingNotificationPayload {
  meeting: Meeting;
  participant: MeetingParticipant;
  kind: MeetingNotificationKind;
}

export type MeetingNotificationResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  /** No delivery implementation exists yet; the idempotency claim is released. */
  | { status: 'unsupported' };

export type MeetingNotificationSender = (
  payload: MeetingNotificationPayload
) => Promise<MeetingNotificationResult>;

/** Test/ops stub: releases every claim so nothing is consumed. */
export const unsupportedMeetingNotificationSender: MeetingNotificationSender = async () => ({
  status: 'unsupported',
});

/** On by default; set MEETING_NOTIFICATIONS_ENABLED=false to pause delivery. */
export function meetingNotificationsEnabled(): boolean {
  return process.env.MEETING_NOTIFICATIONS_ENABLED !== 'false';
}
