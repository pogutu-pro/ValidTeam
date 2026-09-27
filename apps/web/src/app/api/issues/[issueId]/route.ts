import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import {
  getIssueById,
  updateIssue,
  deleteIssue,
  createActivity,
  createAuditLog,
  db,
  issues,
  workflowStatuses,
  projects,
  sprints,
} from '@tasknebula/db';
import { eq, and } from 'drizzle-orm';
import { publishEvent } from '@/lib/realtime/events';
import { notifyIssueEvent } from '@/lib/notifications/send-notification';
import { runAutomations } from '@/lib/automation/evaluator';
import { withValidation } from '@/lib/api-validation';
import { syncIssueLabelsBestEffort } from '@/lib/labels/sync';
import {
  guardAgentAction,
  readAgentPolicyMarker,
  stripAgentPolicyMarker,
} from '@/lib/agent-policy/guard';
import { apiActorCanAccessOrganization, resolveApiActor } from '@/lib/auth/api-actor';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import {
  applyPreparedIssueStatusTransition,
  isWorkflowTransitionError,
  prepareIssueStatusTransition,
  resolveProjectWorkflowStatusByCategory,
  WorkflowTransitionError,
} from '@/lib/workflows/issue-transition-policy';

// Params schema for /api/issues/[issueId] — kept loose (`min(1)`) to allow
// the existing dataset of mixed-format ids; tighten to `id` from
// `@/lib/validation/common` once legacy ids are migrated.
const issueParamsSchema = z.object({ issueId: z.string().min(1) });

type IssueAction =
  | 'view'
  | 'edit'
  | 'delete'
  | 'assign'
  | 'transition'
  | 'schedule'
  | 'close'
  | 'reopen';

// Granular permission check helper for issues
async function checkIssuePermission(
  userId: string,
  projectId: string,
  action: IssueAction,
  issueReporterId?: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  const access = await resolveProjectCapabilityAccess(userId, projectId);
  if (!access.project) {
    return { allowed: false, reason: 'Project not found' };
  }
  if (!access.canRead) return { allowed: false, reason: 'Project access denied' };
  if (access.canManage) return { allowed: true };
  const isOwnIssue = issueReporterId === userId;
  const permissions = access.permissions;

  // Check specific permissions based on action
  switch (action) {
    case 'view':
      return { allowed: true };

    case 'edit':
      // Check if can edit all issues or own issues
      if (permissions.canEditIssues || (isOwnIssue && permissions.canEditOwnIssues)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to edit issues' };

    case 'delete':
      // Check if can delete all issues or own issues
      if (permissions.canDeleteIssues || (isOwnIssue && permissions.canDeleteOwnIssues)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to delete issues' };

    case 'assign':
      if (permissions.canAssignIssues) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to assign issues' };

    case 'transition':
      if (permissions.canTransitionIssues) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to transition issues' };

    case 'schedule':
      if (permissions.canScheduleIssues) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to schedule issues' };

    case 'close':
      if (permissions.canCloseIssues) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to close issues' };

    case 'reopen':
      if (permissions.canReopenIssues) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No permission to reopen issues' };

    default:
      return { allowed: false, reason: 'Unknown action' };
  }
}

// Validation schema for updating an issue
const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  // ProseMirror JSON snapshot from the collaborative editor. Persisted into
  // `issues.description_rich` so the
  // non-collab read path can rebuild lists / bold / links / code blocks.
  descriptionRich: z.record(z.any()).nullable().optional(),
  status: z.string().optional(), // Status category (backlog, in_progress, etc.)
  statusId: z.string().min(1).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  labels: z.array(z.string()).optional(),
  sprintId: z.string().min(1).nullable().optional(),
  epicId: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  estimate: z.number().nullable().optional(),
  // Agile story points (issues.story_points). Non-negative integer or null.
  storyPoints: z.number().int().nonnegative().nullable().optional(),
  // Jira-style impediment marker (issues.flagged boolean).
  flagged: z.boolean().optional(),
  // Time-tracking estimate (in hours) and its provenance — `manual` when the
  // user typed it, `ai_suggest` when the AI estimator wrote it. The
  // TimeTrackingPanel posts both fields together; without them in the
  // schema, Zod silently drops the keys and the panel's "Save estimate"
  // button becomes a no-op.
  estimateHours: z
    .number()
    .nullable()
    .optional()
    // Drizzle `numeric()` columns are typed `string` — coerce before the spread
    // into updateIssue() so the payload matches the column type.
    .transform((v) => (v == null ? v : String(v))),
  estimateSource: z.enum(['manual', 'ai_suggest']).nullable().optional(),
  dueDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    // `timestamp()` columns expect Date — coerce like estimateHours above.
    .transform((v) => (v == null ? v : new Date(v))),
  customFields: z.record(z.any()).optional(),
  // Jira-style resolution. Setting a value also stamps `resolvedAt`;
  // sending an explicit `null` clears both fields.
  resolution: z
    .enum(['fixed', 'wont_do', 'duplicate', 'cannot_reproduce', 'done'])
    .nullable()
    .optional(),
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

// GET /api/issues/[issueId] - Get a single issue
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId } = await params;
    const issue = await getIssueById(issueId);

    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    if (!apiActorCanAccessOrganization(actor, issue.organizationId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Permission check: ensure caller can view this issue
    const permission = await checkIssuePermission(
      actor.userId,
      issue.projectId,
      'view',
      issue.reporterId
    );
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.reason || 'Permission denied' },
        { status: 403 }
      );
    }

    return NextResponse.json(issue);
  } catch (error) {
    console.error('Error fetching issue:', error);
    return NextResponse.json({ error: 'Failed to fetch issue' }, { status: 500 });
  }
}

// PATCH /api/issues/[issueId] - Update an issue
// Migrated to withValidation (FEAT-29). `params` and `body` are now parsed
// by the wrapper; failures short-circuit with a 400 envelope before this
// handler runs.
export const PATCH = withValidation({
  body: updateIssueSchema,
  params: issueParamsSchema,
})(async (request, { body: validatedData, params }) => {
  const { issueId } = params;
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current issue for comparison
    const currentIssue = await getIssueById(issueId);
    if (!currentIssue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    if (!apiActorCanAccessOrganization(actor, currentIssue.organizationId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const agentPolicy = readAgentPolicyMarker(validatedData.agentPolicy);
    const issueInput = stripAgentPolicyMarker(validatedData);

    const [currentProject] = await db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        defaultWorkflowId: projects.defaultWorkflowId,
      })
      .from(projects)
      .where(eq(projects.id, currentIssue.projectId))
      .limit(1);

    if (!currentProject || currentProject.organizationId !== currentIssue.organizationId) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (issueInput.parentId) {
      if (issueInput.parentId === issueId) {
        return NextResponse.json({ error: 'Issue cannot be its own parent' }, { status: 400 });
      }
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
        parentIssue.projectId !== currentIssue.projectId ||
        parentIssue.organizationId !== currentIssue.organizationId
      ) {
        return NextResponse.json(
          { error: 'Parent issue must belong to the same project' },
          { status: 400 }
        );
      }
    }
    if (issueInput.epicId) {
      if (issueInput.epicId === issueId) {
        return NextResponse.json({ error: 'invalid_epic' }, { status: 400 });
      }
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
        epicIssue.projectId !== currentIssue.projectId ||
        epicIssue.organizationId !== currentIssue.organizationId
      ) {
        return NextResponse.json({ error: 'invalid_epic' }, { status: 400 });
      }
    }

    if (issueInput.sprintId) {
      const [sprint] = await db
        .select({ id: sprints.id })
        .from(sprints)
        .where(
          and(eq(sprints.id, issueInput.sprintId), eq(sprints.projectId, currentIssue.projectId))
        )
        .limit(1);
      if (!sprint) {
        return NextResponse.json({ error: 'invalid_sprint' }, { status: 400 });
      }
    }

    if (issueInput.assigneeId) {
      const assigneeAccess = await resolveOrganizationAccess(
        issueInput.assigneeId,
        currentIssue.organizationId,
        { allowSuperAdmin: false }
      );
      if (!assigneeAccess.allowed) {
        return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
      }
    }

    // Determine required permissions based on what's being changed
    const permissionChecks: IssueAction[] = [];

    // Basic edit permission for title, description, priority, labels, estimate, dueDate
    if (
      issueInput.title ||
      issueInput.description !== undefined ||
      issueInput.descriptionRich !== undefined ||
      issueInput.priority ||
      issueInput.labels ||
      issueInput.epicId !== undefined ||
      issueInput.parentId !== undefined ||
      issueInput.estimate !== undefined ||
      issueInput.estimateHours !== undefined ||
      issueInput.estimateSource !== undefined ||
      issueInput.dueDate !== undefined ||
      issueInput.resolution !== undefined ||
      issueInput.flagged !== undefined ||
      issueInput.storyPoints !== undefined ||
      issueInput.customFields !== undefined
    ) {
      permissionChecks.push('edit');
    }

    // Assign permission for assignee changes
    if (issueInput.assigneeId !== undefined && issueInput.assigneeId !== currentIssue.assigneeId) {
      permissionChecks.push('assign');
    }

    // Transition permission for status changes
    if (
      (issueInput.status || issueInput.statusId) &&
      issueInput.statusId !== currentIssue.statusId
    ) {
      permissionChecks.push('transition');
    }

    // Schedule permission for sprint changes
    if (issueInput.sprintId !== undefined && issueInput.sprintId !== currentIssue.sprintId) {
      permissionChecks.push('schedule');
    }

    // Check all required permissions
    for (const action of permissionChecks) {
      const permission = await checkIssuePermission(
        actor.userId,
        currentIssue.projectId,
        action,
        currentIssue.reporterId
      );
      if (!permission.allowed) {
        return NextResponse.json(
          { error: permission.reason || 'Permission denied' },
          { status: 403 }
        );
      }
    }

    if (agentPolicy) {
      let policyResource = agentPolicy.resource || 'issues';
      let policyAction = agentPolicy.action || 'update';
      if (!agentPolicy.resource && !agentPolicy.action) {
        if (
          issueInput.assigneeId !== undefined &&
          issueInput.assigneeId !== currentIssue.assigneeId
        ) {
          policyAction = 'assign';
        } else if (issueInput.labels !== undefined) {
          policyAction = 'label';
        } else if (
          issueInput.statusId !== undefined &&
          issueInput.statusId !== currentIssue.statusId
        ) {
          policyResource = 'boards';
          policyAction = 'move-card';
        } else if (issueInput.resolution !== undefined) {
          policyAction = 'close';
        }
      }

      const guard = await guardAgentAction({
        workspaceId: currentIssue.organizationId,
        projectId: currentIssue.projectId,
        requestedBy: actor.userId,
        actor: agentPolicy.actor,
        resource: policyResource,
        action: policyAction,
        targetType: agentPolicy.targetType || 'issue',
        targetId: issueId,
        proposedPayload: {
          executor: 'issues:update',
          data: {
            issueId,
            data: issueInput,
          },
        },
        context: {
          source: agentPolicy.source,
          issueKey: currentIssue.key,
        },
      });
      if (!guard.allowed) {
        return NextResponse.json(guard.body, { status: guard.httpStatus });
      }
    }

    // Resolve and apply status mutations in one transaction. The canonical
    // policy service locks the issue, validates the tenant/workflow edge and
    // performs a CAS update, so concurrent board/API moves cannot both win.
    const updateData = { ...issueInput };
    delete updateData.status;

    // Resolution write-through: setting a resolution stamps `resolvedAt`;
    // an explicit `resolution: null` clears both fields.
    const resolutionPatch =
      updateData.resolution !== undefined
        ? { resolvedAt: updateData.resolution === null ? null : new Date() }
        : {};

    const statusRequested = issueInput.statusId !== undefined || issueInput.status !== undefined;
    const updatedIssueData = statusRequested
      ? await db.transaction(async (tx) => {
          let targetStatusId = issueInput.statusId;
          if (!targetStatusId && issueInput.status) {
            targetStatusId =
              (await resolveProjectWorkflowStatusByCategory(tx, {
                organizationId: currentIssue.organizationId,
                projectId: currentIssue.projectId,
                issueId,
                category: issueInput.status as typeof workflowStatuses.$inferSelect.category,
              })) ?? undefined;
          }
          if (!targetStatusId) {
            throw new WorkflowTransitionError('workflow_transition_status_invalid');
          }
          updateData.statusId = targetStatusId;
          const prepared = await prepareIssueStatusTransition(tx, {
            organizationId: currentIssue.organizationId,
            projectId: currentIssue.projectId,
            issueId,
            toStatusId: targetStatusId,
            actorUserId: actor.userId,
            expectedFromStatusId: currentIssue.statusId,
          });
          return applyPreparedIssueStatusTransition(tx, {
            prepared,
            actorUserId: actor.userId,
            reason: 'user_api',
            patch: { ...updateData, ...resolutionPatch },
            skipWriteWhenUnchanged: false,
          });
        })
      : await updateIssue(issueId, { ...updateData, ...resolutionPatch });

    if (!updatedIssueData) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    // Write-through to the first-class labels layer. The jsonb write above
    // (`issues.labels`) stays the REST contract; this mirrors the names into
    // labels/issue_labels and never fails the update (best-effort).
    if (issueInput.labels !== undefined) {
      await syncIssueLabelsBestEffort({
        organizationId: currentIssue.organizationId,
        issueId,
        labels: issueInput.labels,
        createdBy: actor.userId,
      });
    }

    // Create activity logs for changed fields
    const activityPromises = [];

    if (updateData.statusId && updateData.statusId !== currentIssue.statusId) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'status_changed',
          field: 'status',
          oldValue: currentIssue.statusId,
          newValue: updateData.statusId,
        })
      );
    }

    if (updateData.assigneeId !== undefined && updateData.assigneeId !== currentIssue.assigneeId) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'assigned',
          field: 'assignee',
          oldValue: currentIssue.assigneeId || null,
          newValue: updateData.assigneeId || null,
        })
      );
    }

    if (updateData.priority && updateData.priority !== currentIssue.priority) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'updated',
          field: 'priority',
          oldValue: currentIssue.priority,
          newValue: updateData.priority,
        })
      );
    }

    if (updateData.title && updateData.title !== currentIssue.title) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'updated',
          field: 'title',
          oldValue: currentIssue.title,
          newValue: updateData.title,
        })
      );
    }

    if (updateData.resolution !== undefined && updateData.resolution !== currentIssue.resolution) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'updated',
          field: 'resolution',
          oldValue: currentIssue.resolution ?? null,
          newValue: updateData.resolution ?? null,
        })
      );
    }

    if (updateData.flagged !== undefined && updateData.flagged !== currentIssue.flagged) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'updated',
          field: 'flagged',
          oldValue: String(currentIssue.flagged ?? false),
          newValue: String(updateData.flagged),
        })
      );
    }

    if (
      updateData.description !== undefined &&
      updateData.description !== currentIssue.description
    ) {
      activityPromises.push(
        createActivity({
          issueId,
          userId: actor.userId,
          type: 'updated',
          field: 'description',
        })
      );
    }

    // Execute all activity logs
    await Promise.all(activityPromises);

    // Create audit log for issue update
    const changes: Record<string, { from: any; to: any }> = {};
    if (updateData.statusId && updateData.statusId !== currentIssue.statusId) {
      changes.status = { from: currentIssue.statusId, to: updateData.statusId };
    }
    if (updateData.assigneeId !== undefined && updateData.assigneeId !== currentIssue.assigneeId) {
      changes.assigneeId = { from: currentIssue.assigneeId, to: updateData.assigneeId };
    }
    if (updateData.priority && updateData.priority !== currentIssue.priority) {
      changes.priority = { from: currentIssue.priority, to: updateData.priority };
    }
    if (updateData.title && updateData.title !== currentIssue.title) {
      changes.title = { from: currentIssue.title, to: updateData.title };
    }

    // Publish realtime event synchronously (in-process bus, microseconds).
    publishEvent('issue.updated', actor.userId, {
      projectId: currentIssue.projectId,
      issueId,
      sprintId: currentIssue.sprintId || undefined,
      organizationId: currentIssue.organizationId,
    });

    // Defer audit log and notification emails to after the response is sent.
    const actorUserId = actor.userId;
    const projectName = currentIssue.key?.split('-')[0] || '';
    const changesSnapshot = changes;
    const newAssigneeId =
      updateData.assigneeId && updateData.assigneeId !== currentIssue.assigneeId
        ? updateData.assigneeId
        : null;
    const statusEmailRecipient =
      updateData.statusId &&
      updateData.statusId !== currentIssue.statusId &&
      currentIssue.assigneeId
        ? currentIssue.assigneeId
        : null;

    after(async () => {
      if (Object.keys(changesSnapshot).length > 0) {
        let action:
          | 'issue.status_changed'
          | 'issue.assigned'
          | 'issue.priority_changed'
          | 'issue.updated' = 'issue.updated';
        if (changesSnapshot.status) {
          action = 'issue.status_changed';
        } else if (changesSnapshot.assigneeId) {
          action = 'issue.assigned';
        } else if (changesSnapshot.priority) {
          action = 'issue.priority_changed';
        }
        try {
          await createAuditLog({
            userId: actorUserId,
            organizationId: currentIssue.organizationId,
            action,
            resourceType: 'issue',
            resourceId: issueId,
            projectId: currentIssue.projectId,
            issueId,
            changes: changesSnapshot,
          });
        } catch (err) {
          console.error('audit log failed', err);
        }
      }

      if (newAssigneeId) {
        try {
          await notifyIssueEvent({
            eventType: 'issue_assigned',
            recipientUserId: newAssigneeId,
            actorUserId,
            organizationId: currentIssue.organizationId,
            issueId,
            projectId: currentIssue.projectId,
            issueKey: currentIssue.key,
            issueTitle: currentIssue.title,
            projectName,
          });
        } catch (err) {
          console.error('assignee notification failed', err);
        }
      }

      if (statusEmailRecipient) {
        try {
          await notifyIssueEvent({
            eventType: 'issue_status_changed',
            recipientUserId: statusEmailRecipient,
            actorUserId,
            organizationId: currentIssue.organizationId,
            issueId,
            projectId: currentIssue.projectId,
            issueKey: currentIssue.key,
            issueTitle: currentIssue.title,
            projectName,
          });
        } catch (err) {
          console.error('status notification failed', err);
        }
      }
    });

    // --- Automation triggers (fire-and-forget) ---
    // Compute which fields changed between old and new so rules can match.
    const changedFields: string[] = [];
    const trackedFields: (keyof typeof updateData)[] = [
      'title',
      'description',
      'statusId',
      'priority',
      'assigneeId',
      'labels',
      'sprintId',
      'epicId',
      'parentId',
      'estimate',
      'dueDate',
      'customFields',
      'resolution',
      'flagged',
      'storyPoints',
    ];
    for (const field of trackedFields) {
      if (updateData[field] === undefined) continue;
      const before = (currentIssue as Record<string, unknown>)[field];
      const after = (updateData as Record<string, unknown>)[field];
      if (before !== after) {
        changedFields.push(field as string);
      }
    }

    const statusChanged = !!updateData.statusId && updateData.statusId !== currentIssue.statusId;
    const assigneeChanged =
      updateData.assigneeId !== undefined && updateData.assigneeId !== currentIssue.assigneeId;

    // If status transitioned, look up the new status metadata so rule
    // conditions can match on name/category (nice-to-have per spec).
    let newStatus: { id: string; name: string; category: string } | null = null;
    if (statusChanged && updateData.statusId) {
      const [statusRow] = await db
        .select({
          id: workflowStatuses.id,
          name: workflowStatuses.name,
          category: workflowStatuses.category,
        })
        .from(workflowStatuses)
        .where(eq(workflowStatuses.id, updateData.statusId))
        .limit(1);
      if (statusRow) {
        newStatus = {
          id: statusRow.id,
          name: statusRow.name,
          category: statusRow.category as string,
        };
      }
    }

    const automationPayload = {
      before: currentIssue,
      after: updatedIssueData,
      changedFields,
      ...(newStatus ? { newStatus } : {}),
    };

    // Defer automation rule evaluation until after the response is sent.
    after(async () => {
      try {
        await runAutomations({
          trigger: 'issue.updated',
          organizationId: currentIssue.organizationId,
          projectId: currentIssue.projectId,
          payload: automationPayload,
          actorUserId,
        });
      } catch (err) {
        console.error('automation failed', err);
      }

      if (statusChanged) {
        try {
          await runAutomations({
            trigger: 'issue.status_changed',
            organizationId: currentIssue.organizationId,
            projectId: currentIssue.projectId,
            payload: automationPayload,
            actorUserId,
          });
        } catch (err) {
          console.error('automation failed', err);
        }
      }

      if (assigneeChanged) {
        try {
          await runAutomations({
            trigger: 'issue.assigned',
            organizationId: currentIssue.organizationId,
            projectId: currentIssue.projectId,
            payload: automationPayload,
            actorUserId,
          });
        } catch (err) {
          console.error('automation failed', err);
        }
      }
    });

    return NextResponse.json(updatedIssueData);
  } catch (error) {
    if (isWorkflowTransitionError(error)) {
      return NextResponse.json(
        { error: error.code, code: error.code },
        { status: error.httpStatus }
      );
    }
    console.error('Error updating issue:', error);
    return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
  }
});

// DELETE /api/issues/[issueId] - Delete an issue
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const actor = await resolveApiActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId } = await params;

    // Get issue to check project and reporter
    const issue = await getIssueById(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    if (!apiActorCanAccessOrganization(actor, issue.organizationId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check permission to delete issues (with reporter check for own issues)
    const permission = await checkIssuePermission(
      actor.userId,
      issue.projectId,
      'delete',
      issue.reporterId
    );
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.reason || 'Permission denied' },
        { status: 403 }
      );
    }

    await deleteIssue(issueId);

    publishEvent('issue.deleted', actor.userId, {
      projectId: issue.projectId,
      issueId,
      sprintId: issue.sprintId || undefined,
      organizationId: issue.organizationId,
    });

    return NextResponse.json({ success: true, id: issueId });
  } catch (error) {
    console.error('Error deleting issue:', error);
    return NextResponse.json({ error: 'Failed to delete issue' }, { status: 500 });
  }
}
