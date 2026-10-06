/** POST /api/meetings/:slug/pulse — browser keep-alive (fallback signal only). */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGuestPrincipal } from '@/lib/meetings/access';
import { buildMeetingIdentity } from '@/lib/meetings/livekit';
import { recordPulseWithSession } from '@/lib/meetings/service';
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
  clientSessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseJson(request, bodySchema);
    enforceRateLimit(`meetings:pulse:${clientIp(request)}:${id}`, 20, 60_000);
    if (body.guestToken) {
      const { meeting, principal } = await resolveGuestPrincipal(id, body.guestToken);
      await recordPulseWithSession(
        meeting,
        principal.participant.id,
        body.clientSessionId
          ? buildMeetingIdentity(principal.participant.id, body.clientSessionId)
          : null
      );
    } else {
      const { meeting, principal } = await loadMeetingForMember(request, id);
      if (principal.participant) {
        await recordPulseWithSession(
          meeting,
          principal.participant.id,
          body.clientSessionId
            ? buildMeetingIdentity(principal.participant.id, body.clientSessionId)
            : null
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
