/**
 * LiveKit webhook handling for meeting rooms (`vm-*`). LiveKit is the primary
 * source of attendance truth; the identity is parsed and then verified against
 * the meeting's own participant rows, so a forged/foreign identity can never
 * create attendance for someone else.
 */
import { db, meetings, meetingParticipants, and, eq } from '@validteam/db';
import { recordMeetingEvent } from './events';
import { parseMeetingIdentity } from './livekit';
import { removeParticipantQuietly } from './livekit-admin';
import { endMeeting, recordParticipantJoined, recordParticipantLeft } from './service';

export interface MeetingWebhookInput {
  event: string;
  roomName: string;
  participantIdentity?: string | null;
  /** 'screen_share' | 'screen_share_audio' | 'camera' | ... (lower-cased by caller) */
  trackSource?: string | null;
  /** Event time from LiveKit (epoch seconds). */
  createdAt?: number | bigint | null;
}

const MAX_SKEW_MS = 24 * 3600_000;

/** Trust LiveKit's timestamp unless it is absurd (future / >24h old). */
export function resolveEventTime(
  createdAt: number | bigint | null | undefined,
  now: Date = new Date()
): Date {
  if (createdAt === null || createdAt === undefined) return now;
  const ms = Number(createdAt) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return now;
  if (ms > now.getTime() + 60_000 || ms < now.getTime() - MAX_SKEW_MS) return now;
  return new Date(Math.min(ms, now.getTime()));
}

export async function handleMeetingWebhookEvent(input: MeetingWebhookInput) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.livekitRoomName, input.roomName))
    .limit(1);
  if (!meeting) return { handled: false, reason: 'meeting_not_found' as const };

  const at = resolveEventTime(input.createdAt);

  if (input.event === 'room_finished') {
    const res = await endMeeting(meeting.id, { reason: 'livekit_room_finished', at });
    return { handled: true, reason: res.ended ? ('ended' as const) : ('already_closed' as const) };
  }

  const parsed = parseMeetingIdentity(input.participantIdentity);
  if (!parsed) return { handled: false, reason: 'unknown_identity' as const };

  const [participant] = await db
    .select()
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.id, parsed.participantId),
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.organizationId, meeting.organizationId)
      )
    )
    .limit(1);
  if (!participant) return { handled: false, reason: 'participant_not_in_meeting' as const };

  switch (input.event) {
    case 'participant_joined': {
      const res = await recordParticipantJoined({
        meetingId: meeting.id,
        participantId: participant.id,
        identity: input.participantIdentity!,
        at,
      });
      if (!res.recorded && res.reason === 'participant_removed') {
        await removeParticipantQuietly(input.roomName, input.participantIdentity!);
      }
      return { handled: true, reason: res.recorded ? ('joined' as const) : res.reason };
    }
    case 'participant_left':
    case 'participant_connection_aborted': {
      const res = await recordParticipantLeft({
        meetingId: meeting.id,
        identity: input.participantIdentity!,
        at,
        reason: input.event === 'participant_left' ? 'left' : 'disconnected',
      });
      return {
        handled: true,
        reason: res.closed ? ('left' as const) : ('no_open_session' as const),
      };
    }
    case 'track_published':
    case 'track_unpublished': {
      if (input.trackSource !== 'screen_share')
        return { handled: false, reason: 'ignored_event' as const };
      await recordMeetingEvent(db, {
        meetingId: meeting.id,
        organizationId: meeting.organizationId,
        participantId: participant.id,
        type: input.event === 'track_published' ? 'screen_share_started' : 'screen_share_stopped',
        occurredAt: at,
      });
      return { handled: true, reason: 'screen_share' as const };
    }
    default:
      return { handled: false, reason: 'ignored_event' as const };
  }
}
