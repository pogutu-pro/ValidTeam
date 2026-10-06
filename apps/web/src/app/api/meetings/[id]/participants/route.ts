/**
 * GET    /api/meetings/:slug/participants                      roster (members)
 * POST   /api/meetings/:slug/participants                      invite more people (host/admin)
 * DELETE /api/meetings/:slug/participants?participantId=...    remove + kick (host/admin)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MeetingError } from '@/lib/meetings/errors';
import { addParticipants, listParticipants, removeParticipant } from '@/lib/meetings/service';
import { removeParticipantQuietly } from '@/lib/meetings/livekit-admin';
import { errorResponse, loadMeetingForMember, parseJson } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { meeting, principal } = await loadMeetingForMember(request, id);
    const rows = await listParticipants(meeting);
    return NextResponse.json({
      participants: rows
        .filter((p) => !p.removedAt)
        .map((p) => ({
          participantId: p.id,
          role: p.role,
          kind: p.userId ? 'member' : 'guest',
          userId: p.userId,
          name: p.guestName,
          email: principal.canManage ? p.guestEmail : null,
        })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const addSchema = z.object({
  participantUserIds: z.array(z.string().min(1)).max(200).default([]),
  guests: z
    .array(z.object({ email: z.string().email().max(320), name: z.string().max(200).optional() }))
    .max(200)
    .default([]),
});

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { meeting, principal } = await loadMeetingForMember(request, id);
    if (!principal.canManage)
      throw new MeetingError('forbidden', 403, 'Only the host or an admin can invite people');
    const body = await parseJson(request, addSchema);
    const result = await addParticipants(meeting, {
      userIds: body.participantUserIds,
      guests: body.guests,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { actor, meeting, principal } = await loadMeetingForMember(request, id);
    if (!principal.canManage)
      throw new MeetingError('forbidden', 403, 'Only the host or an admin can remove people');
    const participantId = new URL(request.url).searchParams.get('participantId');
    if (!participantId)
      throw new MeetingError('VALIDATION_FAILED', 400, 'participantId is required');

    const result = await removeParticipant(meeting, participantId, actor.userId);
    if (!result.removed)
      throw new MeetingError(
        'not_found',
        404,
        'Participant not found (the host cannot be removed)'
      );
    if (meeting.livekitRoomName) {
      await Promise.all(
        result.openIdentities.map((identity) =>
          removeParticipantQuietly(meeting.livekitRoomName!, identity)
        )
      );
    }
    return NextResponse.json({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
