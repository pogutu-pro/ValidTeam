/** POST /api/meetings/:slug/end — end the meeting for everyone (host or org admin). */
import { NextResponse } from 'next/server';
import { MeetingError } from '@/lib/meetings/errors';
import { endMeeting } from '@/lib/meetings/service';
import { deleteRoomQuietly } from '@/lib/meetings/livekit-admin';
import { errorResponse, loadMeetingForMember } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { actor, meeting, principal } = await loadMeetingForMember(request, id);
    if (!principal.canManage)
      throw new MeetingError('forbidden', 403, 'Only the host or an admin can end this meeting');
    if (meeting.status === 'scheduled')
      throw new MeetingError('invalid_state', 409, 'Meeting has not started; cancel it instead');

    const result = await endMeeting(meeting.id, { by: actor.userId, reason: 'host_ended' });
    // Kick everyone still connected; the DB is already the source of truth.
    if (result.ended && meeting.livekitRoomName) await deleteRoomQuietly(meeting.livekitRoomName);
    return NextResponse.json({ ended: result.ended });
  } catch (error) {
    return errorResponse(error);
  }
}
