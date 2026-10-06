/** GET /api/meetings/:slug/analytics — computed stats (available after the meeting ends). */
import { NextResponse } from 'next/server';
import { db, meetingParticipants, users, and, eq } from '@validteam/db';
import { getMeetingAnalyticsDetail } from '@/lib/meetings/analytics';
import { errorResponse, loadMeetingForMember } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { meeting, principal } = await loadMeetingForMember(request, id);
    const stats = await getMeetingAnalyticsDetail(meeting.id, meeting.organizationId);
    if (!stats) return NextResponse.json({ available: false, status: meeting.status });

    const rows = await db
      .select({ p: meetingParticipants, name: users.name, email: users.email })
      .from(meetingParticipants)
      .leftJoin(users, eq(users.id, meetingParticipants.userId))
      .where(
        and(
          eq(meetingParticipants.meetingId, meeting.id),
          eq(meetingParticipants.organizationId, meeting.organizationId)
        )
      );

    // Per-person rows: everyone for hosts/admins, only one's own row otherwise.
    const visible = rows.filter(
      ({ p }) => p.statsComputedAt && (principal.canManage || p.userId === principal.userId)
    );
    return NextResponse.json({
      available: true,
      summary: { ...stats, hostId: undefined, organizationId: undefined },
      participants: visible.map(({ p, name, email }) => ({
        participantId: p.id,
        name: p.userId ? name : p.guestName,
        email: p.userId ? email : principal.canManage ? p.guestEmail : null,
        kind: p.userId ? 'member' : 'guest',
        firstJoinedAt: p.firstJoinedAt,
        lastLeftAt: p.lastLeftAt,
        attendedSeconds: p.attendedSeconds,
        attendancePct: p.attendancePct,
        joinCount: p.joinCount,
        leaveCount: p.leaveCount,
        lateArrival: p.lateArrival,
        earlyDeparture: p.earlyDeparture,
        noShow: p.noShow,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
