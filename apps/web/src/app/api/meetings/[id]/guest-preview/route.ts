/**
 * POST /api/meetings/:slug/guest-preview — what the guest pre-join screen shows
 * (title, host, time, status) without minting a token or starting the meeting.
 * Same uniform failure and rate limit as guest-join.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, users, eq } from '@validteam/db';
import { resolveGuestPrincipal } from '@/lib/meetings/access';
import { clientIp, enforceRateLimit, errorResponse, parseJson } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().max(200) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    enforceRateLimit(`meetings:guest-join:${clientIp(request)}:${id}`, 30, 60_000);
    const { token } = await parseJson(request, bodySchema);
    const { meeting, principal } = await resolveGuestPrincipal(id, token);
    const [host] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, meeting.hostId))
      .limit(1);
    return NextResponse.json({
      meeting: {
        title: meeting.title,
        status: meeting.status,
        scheduledStartAt: meeting.scheduledStartAt,
        scheduledEndAt: meeting.scheduledEndAt,
        host: { name: host?.name ?? host?.email ?? null },
      },
      guest: { name: principal.participant.guestName },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
