/** POST /api/meetings/:slug/join — member join; returns a short-lived LiveKit token. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MeetingError } from '@/lib/meetings/errors';
import { ensureMemberParticipant } from '@/lib/meetings/access';
import { assertJoinable, ensureMeetingLive } from '@/lib/meetings/service';
import { issueMeetingToken } from '@/lib/meetings/join';
import {
  displayNameFor,
  enforceRateLimit,
  errorResponse,
  loadMeetingForMember,
  meetingSummary,
  parseJson,
} from '@/lib/meetings/api';
import { resolveLivekitPublicUrl } from '@/lib/chat/livekit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ clientSessionId: z.string().max(64).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { actor, meeting, principal } = await loadMeetingForMember(request, id);
    if (!principal.canJoin)
      throw new MeetingError('forbidden', 403, 'You are not invited to this meeting');
    enforceRateLimit(`meetings:join:${actor.userId}`, 30, 60_000);
    const body = await parseJson(request, bodySchema);

    assertJoinable(meeting, { isHost: principal.isHost });
    const participant = await ensureMemberParticipant(meeting, principal);
    const live = await ensureMeetingLive(meeting);

    const credentials = await issueMeetingToken({
      meeting: live,
      participant,
      role: principal.isHost ? 'host' : 'participant',
      displayName: await displayNameFor(actor.userId),
      clientSessionId: body.clientSessionId,
      publicUrl: resolveLivekitPublicUrl(request),
    });
    return NextResponse.json({ ...credentials, meeting: meetingSummary(live) });
  } catch (error) {
    return errorResponse(error);
  }
}
