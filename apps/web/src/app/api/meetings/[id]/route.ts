/**
 * GET   /api/meetings/:slug   details (+ participant roster per viewer's privilege)
 * PATCH /api/meetings/:slug   edit / reschedule / cancel (host or org admin)
 * `:slug` is the unguessable public meeting identifier, never an internal id.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, meetings, meetingParticipants, users, and, eq } from '@validteam/db';
import { MeetingError } from '@/lib/meetings/errors';
import { cancelMeeting, cancelSeries, rescheduleMeeting } from '@/lib/meetings/service';
import { errorResponse, loadMeetingForMember, meetingSummary, parseJson } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { meeting, principal } = await loadMeetingForMember(request, id);

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

    const roster = rows
      .filter((r) => !r.p.removedAt)
      .map(({ p, name, email }) => {
        const own = p.userId === principal.userId;
        const privileged = principal.canManage;
        return {
          participantId: p.id,
          role: p.role,
          kind: p.userId ? ('member' as const) : ('guest' as const),
          name: p.userId ? name : p.guestName,
          // Guest e-mail addresses are only visible to the people running the meeting.
          email: p.userId ? email : privileged ? p.guestEmail : null,
          ...(privileged || own
            ? {
                attendance: p.statsComputedAt
                  ? {
                      firstJoinedAt: p.firstJoinedAt,
                      lastLeftAt: p.lastLeftAt,
                      attendedSeconds: p.attendedSeconds,
                      attendancePct: p.attendancePct,
                      joinCount: p.joinCount,
                      lateArrival: p.lateArrival,
                      earlyDeparture: p.earlyDeparture,
                      noShow: p.noShow,
                    }
                  : null,
              }
            : {}),
        };
      });

    const [hostRow] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, meeting.hostId))
      .limit(1);
    return NextResponse.json({
      meeting: {
        ...meetingSummary(meeting),
        host: { name: hostRow?.name ?? hostRow?.email ?? null },
      },
      you: { isHost: principal.isHost, canManage: principal.canManage, canJoin: principal.canJoin },
      participants: roster,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    durationMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
    cancel: z.literal(true).optional(),
    scope: z.enum(['occurrence', 'series']).default('occurrence'),
  })
  .refine(
    (v) => v.cancel || v.title || v.description !== undefined || v.startAt || v.durationMinutes,
    {
      message: 'Nothing to update',
    }
  );

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { meeting, principal, actor } = await loadMeetingForMember(request, id);
    if (!principal.canManage)
      throw new MeetingError('forbidden', 403, 'Only the host or an admin can edit this meeting');
    const body = await parseJson(request, patchSchema);

    if (body.cancel) {
      if (meeting.status === 'live')
        throw new MeetingError('invalid_state', 409, 'End the live meeting instead');
      if (body.scope === 'series' && meeting.seriesId) {
        const n = await cancelSeries(meeting.seriesId, meeting.organizationId, actor.userId);
        return NextResponse.json({ cancelled: n });
      }
      const ok = await cancelMeeting(meeting.id, meeting.organizationId, actor.userId);
      if (!ok)
        throw new MeetingError('invalid_state', 409, 'Only scheduled meetings can be cancelled');
      return NextResponse.json({ cancelled: 1 });
    }

    let current = meeting;
    if (body.startAt || body.durationMinutes) {
      current = await rescheduleMeeting(meeting, {
        startAt: body.startAt ? new Date(body.startAt) : meeting.scheduledStartAt,
        ...(body.durationMinutes ? { durationMinutes: body.durationMinutes } : {}),
      });
    }
    if (body.title || body.description !== undefined) {
      if (current.status === 'ended' || current.status === 'cancelled') {
        throw new MeetingError('invalid_state', 409, 'Meeting is closed');
      }
      const [row] = await db
        .update(meetings)
        .set({
          ...(body.title ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(meetings.id, meeting.id), eq(meetings.organizationId, meeting.organizationId))
        )
        .returning();
      current = row ?? current;
    }
    return NextResponse.json({ meeting: meetingSummary(current) });
  } catch (error) {
    return errorResponse(error);
  }
}
