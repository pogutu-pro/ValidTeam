/**
 * Immediate notification dispatch. The cron tick remains the safety net, but
 * nobody should wait up to a minute (or forever, if the scheduler is not
 * running) for an invitation. Dispatch uses the SAME claim ledger as the tick,
 * so running both can never double-send.
 */
import { createMeetingEmailSender } from './email-sender';
import { processNotifications, type NotificationScope } from './notifications';
import { meetingNotificationsEnabled, type MeetingNotificationSender } from './notification-sender';
import type { MeetingNotificationKind } from './notification-sender';

const DISPATCH_BUDGET_MS = 25_000;

export async function dispatchNotifications(
  kinds: MeetingNotificationKind[],
  scope: NotificationScope,
  deps: { sender?: MeetingNotificationSender; now?: Date; force?: boolean } = {}
) {
  if (!deps.force && !meetingNotificationsEnabled()) return null;
  return processNotifications({
    now: deps.now ?? new Date(),
    sender: deps.sender ?? createMeetingEmailSender(),
    kinds,
    scope,
    deadlineMs: Date.now() + DISPATCH_BUDGET_MS,
  });
}

export const dispatchInvitations = (
  meetingId: string,
  deps?: Parameters<typeof dispatchNotifications>[2]
) => dispatchNotifications(['invitation'], { meetingId }, deps);

export const dispatchSummaries = (
  scope: NotificationScope,
  deps?: Parameters<typeof dispatchNotifications>[2]
) => dispatchNotifications(['summary'], scope, deps);
