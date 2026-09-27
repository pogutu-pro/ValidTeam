import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, sprints, issues, projects } from '@tasknebula/db';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { publishEvent } from '@/lib/realtime/events';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

// Permission check helper
async function checkSprintPermission(
  userId: string,
  projectIdOrKey: string,
  action: 'view' | 'create' | 'manage'
): Promise<{ allowed: boolean; reason?: string; notFound?: boolean; projectId?: string }> {
  const access = await resolveProjectCapabilityAccess(userId, projectIdOrKey);
  if (!access.project || !access.canRead) {
    return { allowed: false, reason: 'Project not found', notFound: true };
  }

  if (action === 'view') {
    return { allowed: true, projectId: access.project.id };
  }

  if (action === 'create' || action === 'manage') {
    if (access.permissions.canManageSprints) {
      return { allowed: true, projectId: access.project.id };
    }
    return { allowed: false, reason: 'Insufficient permissions to manage sprints' };
  }

  return { allowed: false, reason: 'Unknown action' };
}

// GET /api/sprints?projectId=xxx
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectIdParam = searchParams.get('projectId');

  if (!projectIdParam) {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
  }

  try {
    // Permission check: caller must be able to view this project's sprints.
    // Cross-org probes get a 404 so project existence is not leaked.
    const permission = await checkSprintPermission(session.user.id, projectIdParam, 'view');
    if (!permission.allowed) {
      if (permission.notFound) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: permission.reason || 'Permission denied' },
        { status: 403 }
      );
    }
    const projectId = permission.projectId!;

    // Fetch sprints with issue counts
    const sprintList = await db
      .select({
        id: sprints.id,
        projectId: sprints.projectId,
        name: sprints.name,
        goal: sprints.goal,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        status: sprints.status,
        createdAt: sprints.createdAt,
        updatedAt: sprints.updatedAt,
        createdBy: sprints.createdBy,
        updatedBy: sprints.updatedBy,
      })
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(desc(sprints.createdAt));

    // Get issue counts for all sprints in a single aggregated query
    const sprintIdsList = sprintList.map((s) => s.id);
    const countsMap = new Map<string, number>();

    if (sprintIdsList.length > 0) {
      const countsResult = await db
        .select({ sprintId: issues.sprintId, total: count() })
        .from(issues)
        .where(inArray(issues.sprintId, sprintIdsList))
        .groupBy(issues.sprintId);

      for (const row of countsResult) {
        if (row.sprintId) {
          countsMap.set(row.sprintId, Number(row.total) || 0);
        }
      }
    }

    const sprintsWithCounts = sprintList.map((sprint) => ({
      ...sprint,
      issueCount: countsMap.get(sprint.id) || 0,
    }));

    return NextResponse.json(sprintsWithCounts);
  } catch (error) {
    console.error('Error fetching sprints:', error);
    return NextResponse.json({ error: 'Failed to fetch sprints' }, { status: 500 });
  }
}

// POST /api/sprints
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { projectId: projectIdParam, name, goal, startDate, endDate } = body;

    if (!projectIdParam || !name || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Project ID, name, start date, and end date are required' },
        { status: 400 }
      );
    }

    // Check permission to create sprints. Cross-org probes get a 404 so
    // project existence is not leaked.
    const permission = await checkSprintPermission(session.user.id, projectIdParam, 'create');
    if (!permission.allowed) {
      if (permission.notFound) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: permission.reason || 'Permission denied' },
        { status: 403 }
      );
    }
    const projectId = permission.projectId!;

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    if (end <= start) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
    }

    // Sprint duration should be reasonable (1-90 days)
    const durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (durationDays < 1 || durationDays > 90) {
      return NextResponse.json(
        { error: 'Sprint duration must be between 1 and 90 days' },
        { status: 400 }
      );
    }

    const newSprint = await db
      .insert(sprints)
      .values({
        id: createId(),
        projectId,
        name,
        goal: goal || null,
        startDate: start,
        endDate: end,
        status: 'planned',
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    const createdSprint = newSprint[0];
    if (!createdSprint) {
      throw new Error('Failed to create sprint');
    }

    // Sprints carry no organization_id column; resolve it via the project so
    // the realtime event survives the SSE stream's org filter.
    const [sprintProject] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, createdSprint.projectId))
      .limit(1);

    publishEvent('sprint.created', session.user.id, {
      projectId: createdSprint.projectId,
      sprintId: createdSprint.id,
      organizationId: sprintProject?.organizationId,
    });

    return NextResponse.json(createdSprint, { status: 201 });
  } catch (error) {
    console.error('Error creating sprint:', error);
    return NextResponse.json({ error: 'Failed to create sprint' }, { status: 500 });
  }
}
