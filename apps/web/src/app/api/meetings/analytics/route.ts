/**
 * GET /api/meetings/analytics?organizationId&from&to&bucket&timezone&scope=organization|me
 * Organization scope is limited to owners/admins; every member may read their own.
 */
import { NextResponse } from 'next/server';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import { MeetingError } from '@/lib/meetings/errors';
import {
  MAX_RANGE_DAYS,
  analyticsQuerySchema,
  getOrganizationMeetingAnalytics,
  getPersonalMeetingAnalytics,
} from '@/lib/meetings/analytics';
import { errorResponse, parseQuery, requireActor } from '@/lib/meetings/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const q = parseQuery(request, analyticsQuerySchema);
    if (actor.organizationId && actor.organizationId !== q.organizationId) {
      throw new MeetingError('not_found', 404, 'Organization not found');
    }
    const from = new Date(q.from).getTime();
    const to = new Date(q.to).getTime();
    if (!(to > from) || (to - from) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new MeetingError(
        'VALIDATION_FAILED',
        400,
        `Range must be positive and at most ${MAX_RANGE_DAYS} days`
      );
    }
    const access = await resolveOrganizationAccess(actor.userId, q.organizationId, {
      allowSuperAdmin: false,
    });
    if (!access.allowed) throw new MeetingError('not_found', 404, 'Organization not found');

    if (q.scope === 'me') {
      return NextResponse.json(await getPersonalMeetingAnalytics(actor.userId, q));
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      throw new MeetingError('forbidden', 403, 'Organization analytics are limited to admins');
    }
    return NextResponse.json(await getOrganizationMeetingAnalytics(q));
  } catch (error) {
    return errorResponse(error);
  }
}
