import type { Meeting, MeetingParticipant } from '@validteam/db';
import { createLivekitToken } from '@/lib/chat/livekit';
import { MeetingError } from './errors';
import {
  buildMeetingIdentity,
  grantForRole,
  sanitizeClientSessionId,
  tokenTtlSeconds,
  type MeetingLivekitRole,
} from './livekit';
import { joinDeadline } from './notification-rules';

/**
 * Mint a role-scoped LiveKit token. The identity embeds the participant id so
 * webhooks can attribute attendance without trusting client-supplied data.
 */
export async function issueMeetingToken(input: {
  meeting: Meeting;
  participant: MeetingParticipant;
  role: MeetingLivekitRole;
  displayName: string;
  clientSessionId?: string | undefined;
  publicUrl?: string | undefined;
}) {
  const roomName = input.meeting.livekitRoomName;
  if (!roomName) throw new MeetingError('meeting_not_live', 409, 'Meeting room is not ready');

  const identity = buildMeetingIdentity(
    input.participant.id,
    sanitizeClientSessionId(input.clientSessionId)
  );
  const lk = await createLivekitToken({
    roomName,
    identity,
    name: input.displayName,
    metadata: JSON.stringify({ participantId: input.participant.id, role: input.role }),
    grant: grantForRole(roomName, input.role),
    ttlSeconds: tokenTtlSeconds(joinDeadline(input.meeting)),
    ...(input.publicUrl ? { publicUrlOverride: input.publicUrl } : {}),
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'LiveKit is not configured') {
      throw new MeetingError('livekit_unavailable', 503, 'Video service is not configured');
    }
    throw e;
  });

  return {
    url: lk.url,
    token: lk.token,
    identity,
    role: input.role,
    participantId: input.participant.id,
  };
}
