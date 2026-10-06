import { db, meetingEvents } from '@validteam/db';

/** Low-frequency lifecycle events only; never per-heartbeat or per-track noise. */
export type MeetingEventType =
  | 'meeting_created'
  | 'meeting_invitation_sent'
  | 'meeting_started'
  | 'participant_joined'
  | 'participant_left'
  | 'participant_rejoined'
  | 'participant_removed'
  | 'screen_share_started'
  | 'screen_share_stopped'
  | 'meeting_ended'
  | 'meeting_cancelled'
  | 'meeting_summary_generated'
  | 'notification_sent'
  | 'no_show_detected';

type Executor = Pick<typeof db, 'insert'>;

export async function recordMeetingEvent(
  executor: Executor,
  event: {
    meetingId: string;
    organizationId: string;
    type: MeetingEventType;
    participantId?: string | null;
    occurredAt?: Date;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  await executor.insert(meetingEvents).values({
    meetingId: event.meetingId,
    organizationId: event.organizationId,
    type: event.type,
    participantId: event.participantId ?? null,
    occurredAt: event.occurredAt ?? new Date(),
    data: event.data ?? {},
  });
}
