/** POST /api/meetings/:slug/pulse — browser keep-alive (fallback signal only). */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGuestPrincipal } from '@/lib/meetings/access';
import { recordPulse } from '@/lib/meetings/service';
import {
  clientIp,
  enforceRateLimit,
  errorResponse,
  loadMeetingForMember,
  parseJson,
} from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ guestToken: z.string().max(200).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseJson(request, bodySchema);
    enforceRateLimit(`meetings:pulse:${clientIp(request)}:${id}`, 20, 60_000);
    if (body.guestToken) {
      const { meeting, principal } = await resolveGuestPrincipal(id, body.guestToken);
      await recordPulse(meeting.id, principal.participant.id);
    } else {
      const { meeting, principal } = await loadMeetingForMember(request, id);
      if (principal.participant) await recordPulse(meeting.id, principal.participant.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
