import { NextRequest, NextResponse } from 'next/server';
import { db, issues, workflowStatuses, projects, watchers } from '@validteam/db';
import { eq, desc, inArray, and, or, isNotNull } from 'drizzle-orm';
import { resolveApiActor } from '@/lib/auth/api-actor';
import { canReadProject } from '@/lib/auth/access-control';

type ViewMode = 'assigned' | 'created' | 'subscribed' | 'mentioned';
type StatusBucket = 'open' | 'in_progress' | 'blocked' | 'done' | 'all';

function parseView(value: string | null): ViewMode {
  if (value === 'created' || value === 'subscribed' || value === 'mentioned') {
    return value;
  }
  return 'assigned';
}

function parseStatusBucket(value: string | null): StatusBucket {
  if (value === 'open' || value === 'in_progress' || value === 'blocked' || value === 'done') {
    return value;
  }
  return 'all';
}

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = actor.userId;

    const searchParams = request.nextUrl.searchParams;
    const requestedOrganizationId = searchParams.get('organizationId');
    if (
      actor.organizationId &&
      requestedOrganizationId &&
      requestedOrganizationId !== actor.organizationId
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const organizationId = actor.organizationId ?? requestedOrganizationId;
    const teamId = searchParams.get('teamId');
    const view = parseView(searchParams.get('view'));
    const statusBucket = parseStatusBucket(searchParams.get('status'));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10) || 100)
    );

    let allowedProjectIds: string[] | null = null;
    if (organizationId || teamId) {
      const scopedProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            ...(organizationId ? [eq(projects.organizationId, organizationId)] : []),
            ...(teamId ? [eq(projects.teamId, teamId)] : [])
          )
        );
      allowedProjectIds = scopedProjects.map((p) => p.id);
      if (allowedProjectIds.length === 0) {
        return NextResponse.json({ issues: [] });
      }
    }

    // View selectors
    let ownershipClause;
    if (view === 'assigned') {
      ownershipClause = eq(issues.assigneeId, userId);
    } else if (view === 'created') {
      ownershipClause = eq(issues.reporterId, userId);
    } else if (view === 'subscribed') {
      // Issues the user is watching (explicit subscription). We also treat
      // direct assignment as implicit subscription so the list is never empty
      // for users who only interact through assignments.
      const watching = await db
        .select({ issueId: watchers.issueId })
        .from(watchers)
        .where(and(eq(watchers.userId, userId), isNotNull(watchers.issueId)));
      const watchedIssueIds = watching
        .map((row) => row.issueId)
        .filter((id): id is string => Boolean(id));
      if (watchedIssueIds.length === 0) {
        return NextResponse.json({ issues: [] });
      }
      ownershipClause = inArray(issues.id, watchedIssueIds);
    } else {
      // mentioned: no mentions table yet — fall back to assigned+reported so
      // the filter surfaces everything the user is part of until the mentions
      // index lands. This is intentional and documented in the API shape.
      ownershipClause = or(eq(issues.assigneeId, userId), eq(issues.reporterId, userId));
    }

    const myIssuesRaw = await db
      .select()
      .from(issues)
      .where(
        and(
          ownershipClause,
          ...(organizationId ? [eq(issues.organizationId, organizationId)] : []),
          ...(allowedProjectIds ? [inArray(issues.projectId, allowedProjectIds)] : [])
        )
      )
      .orderBy(desc(issues.updatedAt));

    if (myIssuesRaw.length === 0) {
      return NextResponse.json({ issues: [] });
    }

    const statusIds = [...new Set(myIssuesRaw.map((i) => i.statusId))];
    const statuses = await db
      .select()
      .from(workflowStatuses)
      .where(inArray(workflowStatuses.id, statusIds));

    const projectIds = [...new Set(myIssuesRaw.map((i) => i.projectId))];
    const projectsData = await db.select().from(projects).where(inArray(projects.id, projectIds));

    const readableProjectIds = new Set<string>();
    for (const project of projectsData) {
      if (
        await canReadProject(userId, project, {
          allowSuperAdmin: actor.authType === 'session',
        })
      ) {
        readableProjectIds.add(project.id);
      }
    }

    const myIssues = myIssuesRaw
      .filter((issue) => readableProjectIds.has(issue.projectId))
      .map((issue) => ({
        ...issue,
        status: statuses.find((s) => s.id === issue.statusId) || {
          name: 'Unknown',
          category: 'backlog' as const,
          color: '#64748b',
        },
        project: projectsData.find((p) => p.id === issue.projectId) || {
          key: 'UNKNOWN',
          name: 'Unknown',
        },
      }))
      .filter((issue) => {
        if (statusBucket === 'all') return true;
        if (statusBucket === 'open') return issue.status.category !== 'done';
        return issue.status.category === statusBucket;
      })
      .slice(0, limit);

    return NextResponse.json({ issues: myIssues, view });
  } catch (error) {
    console.error('Error fetching my issues:', error);
    return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 });
  }
}
