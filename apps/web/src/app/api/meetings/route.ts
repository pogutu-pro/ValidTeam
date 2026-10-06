/**
 * GET  /api/meetings?organizationId&scope=upcoming|live|past&view=mine|all&limit
 * POST /api/meetings   create an instant, scheduled or recurring meeting
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, meetings, users, and, eq, gte, lt, inArray, or, sql, desc, asc } from '@validteam/db';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import { MeetingError } from '@/lib/meetings/errors';
import { createMeeting, createMeetingSchema } from '@/lib/meetings/service';
import {
  enforceRateLimit,
  errorResponse,
  meetingSummary,
  parseJson,
  parseQuery,
  requireActor,
} from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

const MEMBER_CREATE_ROLES = new Set(['owner', 'admin', 'member']);

const listQuery = z.object({
  organizationId: z.string().min(1),
  scope: z.enum(['upcoming', 'live', 'past']).default('upcoming'),
  view: z.enum(['mine', 'all']).default('mine'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const q = parseQuery(request, listQuery);
    if (actor.organizationId && actor.organizationId !== q.organizationId) {
      throw new MeetingError('not_found', 404, 'Organization not found');
    }
    const access = await resolveOrganizationAccess(actor.userId, q.organizationId, {
      allowSuperAdmin: false,
    });
    if (!access.allowed) throw new MeetingError('not_found', 404, 'Organization not found');
    const isManager = access.role === 'owner' || access.role === 'admin';
    if (q.view === 'all' && !isManager)
      throw new MeetingError('forbidden', 403, 'Only admins can list all meetings');

    const now = new Date();
    const scopeFilter =
      q.scope === 'live'
        ? eq(meetings.status, 'live')
        : q.scope === 'upcoming'
          ? and(eq(meetings.status, 'scheduled'), gte(meetings.scheduledEndAt, now))
          : or(
              inArray(meetings.status, ['ended', 'cancelled']),
              and(eq(meetings.status, 'scheduled'), lt(meetings.scheduledEndAt, now))
            );
    const mine = sql`EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = ${meetings.id}
      AND mp.user_id = ${actor.userId} AND mp.removed_at IS NULL)`;

    const rows = await db
      .select({
        meeting: meetings,
        hostName: users.name,
        hostEmail: users.email,
        participantCount: sql<number>`(SELECT count(*)::int FROM meeting_participants mp WHERE mp.meeting_id = ${meetings.id} AND mp.removed_at IS NULL)`,
      })
      .from(meetings)
      .innerJoin(users, eq(users.id, meetings.hostId))
      .where(
        and(
          eq(meetings.organizationId, q.organizationId),
          scopeFilter,
          q.view === 'mine' ? or(mine, eq(meetings.hostId, actor.userId)) : undefined
        )
      )
      .orderBy(
        q.scope === 'past' ? desc(meetings.scheduledStartAt) : asc(meetings.scheduledStartAt)
      )
      .limit(q.limit)
      .offset(q.offset);

    return NextResponse.json({
      meetings: rows.map((r) => ({
        ...meetingSummary(r.meeting),
        host: { id: r.meeting.hostId, name: r.hostName, email: r.hostEmail },
        participantCount: r.participantCount,
        isHost: r.meeting.hostId === actor.userId,
      })),
      nextOffset: rows.length === q.limit ? q.offset + q.limit : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const input = await parseJson(request, createMeetingSchema);
    if (actor.organizationId && actor.organizationId !== input.organizationId) {
      throw new MeetingError('not_found', 404, 'Organization not found');
    }
    const access = await resolveOrganizationAccess(actor.userId, input.organizationId, {
      allowSuperAdmin: false,
    });
    if (!access.allowed) throw new MeetingError('not_found', 404, 'Organization not found');
    if (!MEMBER_CREATE_ROLES.has(access.role ?? '')) {
      throw new MeetingError('forbidden', 403, 'Your role cannot create meetings');
    }
    enforceRateLimit(`meetings:create:${actor.userId}`, 30, 60_000);

    const result = await createMeeting(actor.userId, input);
    return NextResponse.json(
      {
        meeting: meetingSummary(result.meeting),
        isSeries: result.seriesId !== null,
        occurrencesCreated: result.occurrencesCreated,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
