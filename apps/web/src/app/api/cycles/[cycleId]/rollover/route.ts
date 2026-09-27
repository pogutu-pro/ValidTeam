import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, sprints } from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import { rolloverCycle } from '@/lib/issues/cycle-rollover';
import { publishEvent } from '@/lib/realtime/events';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

/**
 * POST /api/cycles/[cycleId]/rollover
 *
 * Manual trigger that runs the same logic as the daily cron — moves every
 * non-Done issue from this cycle into the next cycle of its project and
 * appends `cycle_rollover` history rows.
 *
 * Naming note: cycles are stored in the `sprints` table; the `/cycles` URL
 * is the public-facing alias the roadmap uses (FEAT-23). New code should
 * prefer this route over `/api/sprints/[id]` for rollover operations.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { cycleId } = await params;

  const [cycle] = await db.select().from(sprints).where(eq(sprints.id, cycleId)).limit(1);

  if (!cycle) {
    return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
  }

  // Permission: manage_sprints on this project, with org-wide project manager
  // and super-admin fast-paths matching the existing sprint endpoints.
  const access = await resolveProjectCapabilityAccess(userId, cycle.projectId);
  if (!access.project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (!access.canRead || (!access.canManage && !access.permissions.canManageSprints)) {
    return NextResponse.json({ error: 'No permission to manage sprints' }, { status: 403 });
  }

  const result = await rolloverCycle(cycleId, userId, /* manualOverride */ true);

  publishEvent('sprint.updated', userId, {
    projectId: cycle.projectId,
    sprintId: cycleId,
    organizationId: access.project.organizationId,
  });
  if (result.nextCycleId) {
    publishEvent('sprint.updated', userId, {
      projectId: cycle.projectId,
      sprintId: result.nextCycleId,
      organizationId: access.project.organizationId,
    });
  }

  return NextResponse.json({
    cycleId,
    nextCycleId: result.nextCycleId,
    movedIssueIds: result.movedIssueIds,
    movedCount: result.movedIssueIds.length,
    reason: result.reason,
  });
}
