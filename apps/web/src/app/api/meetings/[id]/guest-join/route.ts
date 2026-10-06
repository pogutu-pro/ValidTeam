/**
 * POST /api/meetings/:slug/guest-join — external guest join, no ValidTeam account.
 * Authority is the guest token from the invitation link; it is hashed, scoped to
 * this meeting, expiring and revocable. Failures are deliberately uniform.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, meetingParticipants, eq } from '@validteam/db';
import { resolveGuestPrincipal } from '@/lib/meetings/access';
import { assertJoinable, ensureMeetingLive } from '@/lib/meetings/service';
import { issueMeetingToken } from '@/lib/meetings/join';
import { clientIp, enforceRateLimit, errorResponse, parseJson } from '@/lib/meetings/api';
import { resolveLivekitPublicUrl } from '@/lib/chat/livekit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().max(200),
  name: z.string().trim().min(1).max(80).optional(),
  clientSessionId: z.string().max(64).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    enforceRateLimit(`meetings:guest-join:${clientIp(request)}:${id}`, 10, 60_000);
    const body = await parseJson(request, bodySchema);

    const { meeting, principal } = await resolveGuestPrincipal(id, body.token);
    assertJoinable(meeting, { isHost: false });

    let participant = principal.participant;
    if (body.name && body.name !== participant.guestName) {
      const [updated] = await db
        .update(meetingParticipants)
        .set({ guestName: body.name })
        .where(eq(meetingParticipants.id, participant.id))
        .returning();
      participant = updated ?? participant;
    }
    const live = await ensureMeetingLive(meeting);

    const credentials = await issueMeetingToken({
      meeting: live,
      participant,
      role: 'guest',
      displayName: participant.guestName ?? 'Guest',
      clientSessionId: body.clientSessionId,
      publicUrl: resolveLivekitPublicUrl(request),
    });
    // Guests only learn what the room needs: no org data, no roster, no emails.
    return NextResponse.json({
      ...credentials,
      meeting: { title: live.title, status: live.status, scheduledStartAt: live.scheduledStartAt },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
