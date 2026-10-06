/**
 * POST /api/meetings/:slug/leave — the browser reports that this tab left.
 * A prompt, best-effort signal that complements LiveKit's webhook and the
 * server-side reconciliation; it only ever closes the caller's own session.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGuestPrincipal } from '@/lib/meetings/access';
import { buildMeetingIdentity } from '@/lib/meetings/livekit';
import { recordParticipantLeft } from '@/lib/meetings/service';
import {
  clientIp,
  enforceRateLimit,
  errorResponse,
  loadMeetingForMember,
  parseJson,
} from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  guestToken: z.string().max(200).optional(),
  clientSessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseJson(request, bodySchema);
    enforceRateLimit(`meetings:leave:${clientIp(request)}:${id}`, 20, 60_000);
    const resolved = body.guestToken
      ? await resolveGuestPrincipal(id, body.guestToken)
      : await loadMeetingForMember(request, id);
    const participant = resolved.principal.participant;
    if (participant) {
      await recordParticipantLeft({
        meetingId: resolved.meeting.id,
        identity: buildMeetingIdentity(participant.id, body.clientSessionId),
        at: new Date(),
        reason: 'left',
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
