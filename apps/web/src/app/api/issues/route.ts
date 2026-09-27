import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import {
  createActivity,
  createAuditLog,
  db,
  projects,
  issues,
  workflowStatuses,
  workflows,
  sprints,
  users,
} from '@tasknebula/db';
import { createId } from '@paralleldrive/cuid2';
import { eq, and, desc, sql, inArray, or } from 'drizzle-orm';
import { publishEvent } from '@/lib/realtime/events';
import { notifyIssueEvent } from '@/lib/notifications/send-notification';
import { runAutomations } from '@/lib/automation/evaluator';
import { withValidation } from '@/lib/api-validation';
import { syncIssueLabelsBestEffort } from '@/lib/labels/sync';
import { enqueueTriageOnCreate } from '@/lib/agents/triage-enqueue';
import {
  guardAgentAction,
  readAgentPolicyMarker,
  stripAgentPolicyMarker,
} from '@/lib/agent-policy/guard';
import { apiActorCanAccessOrganization, resolveApiActor } from '@/lib/auth/api-actor';
import { canReadProject, resolveOrganizationAccess } from '@/lib/auth/access-control';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

// Permission check helper for issues
async function checkIssuePermission(
  userId: string,
  projectId: string,
  action: 'view' | 'create' | 'edit' | 'delete'
): Promise<{ allowed: boolean; reason?: string }> {
  const access = await resolveProjectCapabilityAccess(userId, projectId);
  if (!access.project) {
    return { allowed: false, reason: 'Project not found' };
  }
  if (action === 'view') {
    return access.canRead
      ? { allowed: true }
      : { allowed: false, reason: 'Not an active project member' };
  }
  const allowed = {
    create: access.permissions.canCreateIssues,
    edit: access.permissions.canEditIssues,
    delete: access.permissions.canDeleteIssues,
  }[action];
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `Insufficient permissions to ${action} issues` };
}

// Validation schema for creating an issue
const createIssueSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(['story', 'task', 'bug', 'epic']),
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('medium'),
  assigneeId: z.string().min(1).optional(),
  labels: z.array(z.string()).default([]),
  sprintId: z.string().min(1).optional(),
  epicId: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
  estimate: z.number().optional(),
  dueDate: z.string().datetime().optional(),
  customFields: z.record(z.any()).default({}),
  statusId: z.string().min(1).optional(),
  agentPolicy: z
    .object({
      actor: z.string().min(1).max(120),
      source: z.string().max(120).optional(),
      resource: z.string().max(80).optional(),
      action: z.string().max(80).optional(),
      targetType: z.string().max(80).optional(),
    })
    .optional(),
});

// GET /api/issues - List issues with filters
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const projectIdParam = searchParams.get('projectId');
    const assigneeId = searchParams.get('assigneeId');
    const statusParam = searchParams.get('status');
    const sprintId = searchParams.get('sprintId');
    const parentId = searchParams.get('parentId');
    const type = searchParams.get('type');

    // Resolve project keys only inside organizations the actor can reach.
    // Project keys are not globally unique, so a bare key lookup could select
    // a private project with the same key from another organization.
    let requestedProject: typeof projects.$inferSelect | null = null;
    if (projectIdParam) {
      const projectLookup = or(
        eq(projects.id, projectIdParam),
        eq(projects.key, projectIdParam.toUpperCase())
      );
      const candidates = await db.select().from(projects).where(projectLookup);
      const exactIdFirst = [...candidates].sort((project) =>
        project.id === projectIdParam ? -1 : 1
      );
      for (const project of exactIdFirst) {
        if (!apiActorCanAccessOrganization(actor, project.organizationId)) continue;
        const canRead = await canReadProject(actor.userId, project, {
          allowSuperAdmin: actor.authType === 'session',
        });
        if (canRead) {
          requestedProject = project;
          break;
        }
      }

      if (!requestedProject) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Unfiltered issue lists must be constrained to readable projects, not
    // merely organizations where the caller has some membership.
    let readableProjectIds: string[] = [];
    if (requestedProject) {
      readableProjectIds = [requestedProject.id];
    } else {
      const projectCandidates = actor.organizationId
        ? await db.select().from(projects).where(eq(projects.organizationId, actor.organizationId))
        : await db.select().from(projects);
      for (const project of projectCandidates) {
        if (!apiActorCanAccessOrganization(actor, project.organizationId)) continue;
        if (
          await canReadProject(actor.userId, project, {
            allowSuperAdmin: actor.authType === 'session',
          })
        ) {
          readableProjectIds.push(project.id);
        }
      }
    }
    if (readableProjectIds.length === 0) {
      return NextResponse.json({ issues: [], total: 0 });
    }

    // Build query with joins
    let query = db
      .select({
        id: issues.id,
        organizationId: issues.organizationId,
        projectId: issues.projectId,
        key: issues.key,
        number: issues.number,
        type: issues.type,
        title: issues.title,
        description: issues.description,
        statusId: issues.statusId,
        priority: issues.priority,
        assigneeId: issues.assigneeId,
        reporterId: issues.reporterId,
        labels: issues.labels,
        sprintId: issues.sprintId,
        epicId: issues.epicId,
        parentId: issues.parentId,
        estimate: issues.estimate,
        dueDate: issues.dueDate,
        resolution: issues.resolution,
        resolvedAt: issues.resolvedAt,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        status: workflowStatuses.category,
        statusName: workflowStatuses.name,
        statusColor: workflowStatuses.color,
        assignee: {
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        },
      })
      .from(issues)
      .leftJoin(workflowStatuses, eq(issues.statusId, workflowStatuses.id))
      .leftJoin(users, eq(issues.assigneeId, users.id))
      .orderBy(desc(issues.createdAt));

    // Apply filters
    const conditions = [];
    conditions.push(inArray(issues.projectId, readableProjectIds));
    if (assigneeId) {
      conditions.push(eq(issues.assigneeId, assigneeId));
    }
    if (statusParam) {
      conditions.push(eq(workflowStatuses.category, statusParam as any));
    }
    // Handle sprintId filter - 'none' means backlog (no sprint assigned)
    if (sprintId === 'none') {
      conditions.push(sql`${issues.sprintId} IS NULL`);
    } else if (sprintId) {
      conditions.push(eq(issues.sprintId, sprintId));
    }
    // Handle parentId filter for subtasks
    if (parentId) {
      conditions.push(eq(issues.parentId, parentId));
    }
    if (type) {
      conditions.push(eq(issues.type, type as any));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const issuesData = await query;

    return NextResponse.json({
      issues: issuesData,
      total: issuesData.length,
    });
  } catch (error) {
    console.error('Error fetching issues:', error);
    return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 });
  }
}

// POST /api/issues - Create a new issue
// Migrated to withValidation (FEAT-29): the wrapper parses + types `body`
// against `createIssueSchema` and short-circuits with a 400 envelope on
// failure, so this handler only deals with the success path.
export const POST = withValidation({ body: createIssueSchema })(async (
  request,
  { body: validatedData }
) => {
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve an id or key only among projects the actor may create in. Keys
    // are unique per organization, not globally.
    const projectResults = await db
      .select()
      .from(projects)
      .where(
        or(
          eq(projects.id, validatedData.projectId),
          eq(projects.key, validatedData.projectId.toUpperCase())
        )
      );
    const exactIdFirst = [...projectResults].sort((candidate) =>
      candidate.id === validatedData.projectId ? -1 : 1
    );
    let project: (typeof projectResults)[number] | null = null;
    let permissionReason = 'Permission denied';
    for (const candidate of exactIdFirst) {
      if (!apiActorCanAccessOrganization(actor, candidate.organizationId)) continue;
      const permission = await checkIssuePermission(actor.userId, candidate.id, 'create');
      if (permission.allowed) {
        project = candidate;
        break;
      }
      permissionReason = permission.reason || permissionReason;
    }

    if (!project && projectResults.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!project) {
      return NextResponse.json({ error: permissionReason }, { status: 403 });
    }
    const actualProjectId = project.id;

    const agentPolicy = readAgentPolicyMarker(validatedData.agentPolicy);
    const issueInput = stripAgentPolicyMarker(validatedData);

    if (issueInput.parentId) {
      const [parentIssue] = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          organizationId: issues.organizationId,
        })
        .from(issues)
        .where(eq(issues.id, issueInput.parentId))
        .limit(1);

      if (
        !parentIssue ||
        parentIssue.projectId !== actualProjectId ||
        parentIssue.organizationId !== project.organizationId
      ) {
        return NextResponse.json(
          { error: 'Parent issue must belong to the same project' },
          { status: 400 }
        );
      }
    }

    if (issueInput.epicId) {
      const [epicIssue] = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          organizationId: issues.organizationId,
          type: issues.type,
        })
        .from(issues)
        .where(eq(issues.id, issueInput.epicId))
        .limit(1);
      if (
        !epicIssue ||
        epicIssue.type !== 'epic' ||
        epicIssue.projectId !== actualProjectId ||
        epicIssue.organizationId !== project.organizationId
      ) {
        return NextResponse.json({ error: 'invalid_epic' }, { status: 400 });
      }
    }

    if (issueInput.sprintId) {
      const [sprint] = await db
        .select({ id: sprints.id })
        .from(sprints)
        .where(and(eq(sprints.id, issueInput.sprintId), eq(sprints.projectId, actualProjectId)))
        .limit(1);
      if (!sprint) {
        return NextResponse.json({ error: 'invalid_sprint' }, { status: 400 });
      }
    }

    if (issueInput.assigneeId) {
      const assigneeAccess = await resolveOrganizationAccess(
        issueInput.assigneeId,
        project.organizationId,
        { allowSuperAdmin: false }
      );
      if (!assigneeAccess.allowed) {
        return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
      }
    }

    if (agentPolicy) {
      const guard = await guardAgentAction({
        workspaceId: project.organizationId,
        projectId: actualProjectId,
        requestedBy: actor.userId,
        actor: agentPolicy.actor,
        resource: agentPolicy.resource || 'issues',
        action: agentPolicy.action || 'create',
        targetType: agentPolicy.targetType || 'issue',
        proposedPayload: {
          executor: 'issues:create',
          data: {
            ...issueInput,
            projectId: actualProjectId,
          },
        },
        context: {
          source: agentPolicy.source,
          issueType: issueInput.type,
        },
      });
      if (!guard.allowed) {
        return NextResponse.json(guard.body, { status: guard.httpStatus });
      }
    }

    // Get default workflow for the project
    let workflowId = project.defaultWorkflowId;

    if (!workflowId) {
      // Get organization's default workflow
      const defaultWorkflows = await db
        .select()
        .from(workflows)
        .where(
          and(eq(workflows.organizationId, project.organizationId), eq(workflows.isDefault, true))
        )
        .limit(1);

      const defaultWorkflow = defaultWorkflows[0];
      if (!defaultWorkflow) {
        return NextResponse.json({ error: 'No workflow found for project' }, { status: 500 });
      }

      workflowId = defaultWorkflow.id;
    }

    // Get workflow statuses
    const allStatuses = await db
      .select()
      .from(workflowStatuses)
      .where(eq(workflowStatuses.workflowId, workflowId));

    // Resolve the final status. Cross-workflow ids are rejected explicitly so
    // API and MCP callers cannot silently create an issue in an unintended state.
    let finalStatusId: string | undefined;
    if (issueInput.statusId) {
      const match = allStatuses.find((s) => s.id === issueInput.statusId);
      if (!match) {
        return NextResponse.json(
          { error: 'Status does not belong to the project workflow' },
          { status: 400 }
        );
      }
      finalStatusId = match.id;
    }

    if (!finalStatusId) {
      const backlogStatuses = allStatuses
        .filter((s) => s.category === 'backlog')
        .sort((a, b) => a.position - b.position);
      const defaultStatus = backlogStatuses[0];
      if (!defaultStatus) {
        return NextResponse.json({ error: 'No backlog status found in workflow' }, { status: 500 });
      }
      finalStatusId = defaultStatus.id;
    }

    // Serialize number allocation per project so parallel creates cannot pick
    // the same next issue key.
    let newIssue;
    try {
      newIssue = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actualProjectId}))`);

        const lastIssueResults = await tx
          .select()
          .from(issues)
          .where(eq(issues.projectId, actualProjectId))
          .orderBy(desc(issues.number))
          .limit(1);

        const nextNumber = lastIssueResults[0] ? (lastIssueResults[0].number || 0) + 1 : 1;
        const issueKey = `${project.key}-${nextNumber}`;

        const issueData = {
          id: createId(),
          organizationId: project.organizationId,
          projectId: actualProjectId,
          key: issueKey,
          number: nextNumber,
          title: issueInput.title,
          description: issueInput.description || null,
          statusId: finalStatusId,
          priority: issueInput.priority,
          type: issueInput.type,
          reporterId: actor.userId,
          assigneeId: issueInput.assigneeId || null,
          sprintId: issueInput.sprintId || null,
          epicId: issueInput.epicId || null,
          parentId: issueInput.parentId || null,
          estimate: issueInput.estimate ?? null,
          dueDate: issueInput.dueDate ? new Date(issueInput.dueDate) : null,
          labels: issueInput.labels || [],
          customFields: issueInput.customFields || {},
          metadata: {},
          createdBy: actor.userId,
          updatedBy: actor.userId,
        };

        const newIssueResults = await tx.insert(issues).values(issueData).returning();
        return newIssueResults[0];
      });

      if (!newIssue) {
        throw new Error('Failed to create issue');
      }

      // Publish realtime event synchronously so other clients see the new
      // issue immediately (in-process bus, ~microseconds).
      publishEvent('issue.created', actor.userId, {
        projectId: newIssue.projectId,
        issueId: newIssue.id,
        sprintId: newIssue.sprintId || undefined,
        organizationId: newIssue.organizationId,
      });
    } catch (insertError) {
      console.error('Insert error details:', insertError);
      throw insertError;
    }

    // Write-through to the first-class labels layer. The jsonb write above
    // (`issues.labels`) stays the REST contract; this mirrors the names into
    // labels/issue_labels and never fails the create (best-effort).
    if (issueInput.labels && issueInput.labels.length > 0) {
      await syncIssueLabelsBestEffort({
        organizationId: newIssue.organizationId,
        issueId: newIssue.id,
        labels: issueInput.labels,
        createdBy: actor.userId,
      });
    }

    // Defer all post-response side-effects: triage suggestion, activity log,
    // audit log, assignee notification email, and automation rules. The response
    // payload is finalised below — `after()` runs once it has been flushed
    // to the client, so request latency reflects only the DB insert.
    const actorUserId = actor.userId;
    const createdIssue = newIssue;
    const projectKey = project.key;
    after(async () => {
      enqueueTriageOnCreate(createdIssue.id);

      try {
        await createActivity({
          issueId: createdIssue.id,
          userId: actorUserId,
          type: 'created',
        });
      } catch (err) {
        console.error('activity log failed', err);
      }

      try {
        await createAuditLog({
          userId: actorUserId,
          organizationId: createdIssue.organizationId,
          action: 'issue.created',
          resourceType: 'issue',
          resourceId: createdIssue.id,
          projectId: createdIssue.projectId,
          issueId: createdIssue.id,
          metadata: { issueKey: createdIssue.key, title: createdIssue.title },
        });
      } catch (err) {
        console.error('audit log failed', err);
      }

      if (createdIssue.assigneeId) {
        try {
          await notifyIssueEvent({
            eventType: 'issue_assigned',
            recipientUserId: createdIssue.assigneeId,
            actorUserId,
            organizationId: createdIssue.organizationId,
            issueId: createdIssue.id,
            projectId: createdIssue.projectId,
            issueKey: createdIssue.key,
            issueTitle: createdIssue.title,
            projectName: project.name || projectKey,
          });
        } catch (err) {
          console.error('assignee notification failed', err);
        }
      }

      try {
        await runAutomations({
          trigger: 'issue.created',
          organizationId: createdIssue.organizationId,
          projectId: createdIssue.projectId,
          payload: createdIssue,
          actorUserId,
        });
      } catch (err) {
        console.error('automation failed', err);
      }
    });

    return NextResponse.json(newIssue, { status: 201 });
  } catch (error) {
    console.error('Error creating issue:', error);
    return NextResponse.json({ error: 'Failed to create issue' }, { status: 500 });
  }
});
