import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  db,
  issues,
  sprints,
  organizationMembers,
  organizations,
  users,
  createAuditLog,
} from '@validteam/db';
import { eq, inArray, and } from 'drizzle-orm';
import { z } from 'zod';
import { publishEvent } from '@/lib/realtime/events';
import { syncIssueLabelsBestEffort } from '@/lib/labels/sync';
import {
  applyBulkIssueStatusTransitions,
  isWorkflowTransitionError,
  WorkflowTransitionError,
} from '@/lib/workflows/issue-transition-policy';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

export const dynamic = 'force-dynamic';

const bulkUpdateSchema = z.object({
  issueIds: z
    .array(z.string())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'issueIds must be unique',
    }),
  updates: z
    .object({
      statusId: z.string().min(1).optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
      assigneeId: z.string().min(1).nullable().optional(),
      labels: z.array(z.string()).optional(),
      sprintId: z.string().min(1).nullable().optional(),
    })
    .refine((updates) => Object.keys(updates).length > 0, {
      message: 'updates must contain at least one supported field',
    }),
});

const bulkDeleteSchema = z.object({
  issueIds: z
    .array(z.string())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'issueIds must be unique',
    }),
});

type BulkAction = 'edit' | 'delete' | 'transition' | 'assign' | 'schedule';
type BulkIssueScope = { id: string; projectId: string; organizationId: string };

/**
 * Verify the caller has the given permission on every distinct project the
 * provided issues belong to. Rejects the ENTIRE request if any id is
 * unauthorized or unknown.
 */
async function assertBulkPermission(
  userId: string,
  issueIds: string[],
  action: BulkAction
): Promise<{ ok: true; issues: BulkIssueScope[] } | { ok: false; status: number; error: string }> {
  const rows = await db
    .select({ id: issues.id, projectId: issues.projectId, organizationId: issues.organizationId })
    .from(issues)
    .where(inArray(issues.id, issueIds));

  if (rows.length !== issueIds.length) {
    return { ok: false, status: 404, error: 'Some issues not found' };
  }

  const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));

  for (const projectId of projectIds) {
    const access = await resolveProjectCapabilityAccess(userId, projectId);
    if (!access.project) {
      return { ok: false, status: 404, error: 'Project not found' };
    }
    if (
      rows.some(
        (issue) =>
          issue.projectId === projectId && issue.organizationId !== access.project?.organizationId
      )
    ) {
      return { ok: false, status: 404, error: 'Some issues not found' };
    }
    const canModify = {
      edit: access.permissions.canEditIssues,
      delete: access.permissions.canDeleteIssues,
      transition: access.permissions.canTransitionIssues,
      assign: access.permissions.canAssignIssues,
      schedule: access.permissions.canScheduleIssues,
    }[action];

    if (!canModify) {
      const actionLabel = action === 'transition' ? 'transition' : action;
      return {
        ok: false,
        status: 403,
        error: `Insufficient permission to ${actionLabel} issues in one or more projects`,
      };
    }
  }

  return { ok: true, issues: rows };
}

/**
 * POST /api/issues/bulk
 *
 * Bulk update issues
 *
 * Body:
 * {
 *   "action": "update" | "delete",
 *   "issueIds": ["id1", "id2", ...],
 *   "updates": { "status": "done", "priority": "high", ... } // for update action
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action;

    if (!action || !['update', 'delete'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "update" or "delete"' },
        { status: 400 }
      );
    }

    if (action === 'update') {
      return await handleBulkUpdate(body, session.user.id);
    } else if (action === 'delete') {
      return await handleBulkDelete(body, session.user.id);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    if (isWorkflowTransitionError(error)) {
      return NextResponse.json(
        { error: error.code, code: error.code },
        { status: error.httpStatus }
      );
    }

    console.error('Bulk operation error:', error);
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 });
  }
}

/**
 * Handle bulk update
 */
async function handleBulkUpdate(body: any, userId: string) {
  const validatedData = bulkUpdateSchema.parse(body);
  const { issueIds, updates } = validatedData;

  const requiredActions = new Set<BulkAction>();
  if (updates.statusId !== undefined) requiredActions.add('transition');
  if (updates.assigneeId !== undefined) requiredActions.add('assign');
  if (updates.sprintId !== undefined) requiredActions.add('schedule');
  if (updates.priority !== undefined || updates.labels !== undefined) requiredActions.add('edit');
  let authorizedScope: BulkIssueScope[] | null = null;
  for (const action of requiredActions) {
    const permission = await assertBulkPermission(userId, issueIds, action);
    if (!permission.ok) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }
    authorizedScope ??= permission.issues;
  }

  // Prepare every transition before the first mutation. All issue locks,
  // policy checks, updates and history rows share one transaction, so one
  // cross-tenant/invalid edge rolls back the entire bulk operation.
  const updateData: any = {
    ...updates,
    updatedAt: new Date(),
  };
  const { existingIssues, updatedIssues } = await db.transaction(async (tx) => {
    const identities = await tx
      .select({
        organizationId: issues.organizationId,
        projectId: issues.projectId,
        issueId: issues.id,
      })
      .from(issues)
      .where(inArray(issues.id, issueIds))
      .for('update');
    if (identities.length !== issueIds.length) {
      throw new WorkflowTransitionError('workflow_transition_issue_not_found');
    }
    const allowedIdentities = new Set(
      (authorizedScope ?? []).map(
        (identity) => `${identity.id}\u0000${identity.organizationId}\u0000${identity.projectId}`
      )
    );
    if (
      identities.some(
        (identity) =>
          !allowedIdentities.has(
            `${identity.issueId}\u0000${identity.organizationId}\u0000${identity.projectId}`
          )
      )
    ) {
      throw new WorkflowTransitionError('workflow_transition_issue_not_found');
    }

    if (updates.assigneeId) {
      const organizationIds = Array.from(
        new Set(identities.map((identity) => identity.organizationId))
      );
      const memberships = await tx
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(
          and(
            eq(organizationMembers.userId, updates.assigneeId),
            eq(organizationMembers.status, 'active'),
            eq(users.status, 'active'),
            eq(organizations.status, 'active'),
            inArray(organizationMembers.organizationId, organizationIds)
          )
        );
      if (new Set(memberships.map((row) => row.organizationId)).size !== organizationIds.length) {
        throw new WorkflowTransitionError('workflow_transition_relationship_invalid');
      }
    }

    if (updates.sprintId) {
      const projectIds = Array.from(new Set(identities.map((identity) => identity.projectId)));
      const [sprint] = await tx
        .select({ projectId: sprints.projectId })
        .from(sprints)
        .where(and(eq(sprints.id, updates.sprintId), inArray(sprints.projectId, projectIds)))
        .limit(1);
      if (!sprint || projectIds.length !== 1 || sprint.projectId !== projectIds[0]) {
        throw new WorkflowTransitionError('workflow_transition_relationship_invalid');
      }
    }

    if (updates.statusId !== undefined) {
      const result = await applyBulkIssueStatusTransitions(tx, {
        issues: identities,
        toStatusId: updates.statusId,
        actorUserId: userId,
        reason: 'user_bulk',
        patch: updateData,
      });
      return { existingIssues: result.before, updatedIssues: result.after };
    }

    const before = await tx.select().from(issues).where(inArray(issues.id, issueIds));
    if (before.length !== issueIds.length) {
      throw new Error('bulk_issue_not_found');
    }
    const after = await tx
      .update(issues)
      .set(updateData)
      .where(inArray(issues.id, issueIds))
      .returning();
    return { existingIssues: before, updatedIssues: after };
  });

  // Write-through to the first-class labels layer. The jsonb write above
  // (`issues.labels`) stays the REST contract; this mirrors the names into
  // labels/issue_labels per issue and never fails the bulk update.
  if (updates.labels !== undefined) {
    for (const issue of updatedIssues) {
      await syncIssueLabelsBestEffort({
        organizationId: issue.organizationId,
        issueId: issue.id,
        labels: updates.labels,
        createdBy: userId,
      });
    }
  }

  // Create audit logs for each updated issue
  // sprintId -> organizationId, so sprint.issues.changed events carry the org
  // (the SSE stream drops org-less events). An issue's old/new sprint always
  // belongs to the same org as the issue.
  const affectedSprintIds = new Map<string, string>();
  for (const issue of updatedIssues) {
    const oldIssue = existingIssues.find((i) => i.id === issue.id);
    if (oldIssue) {
      try {
        // Build changes object
        const changes: Record<string, { from: any; to: any }> = {};
        for (const key of Object.keys(updates)) {
          const oldValue = (oldIssue as any)[key];
          const newValue = (issue as any)[key];
          if (oldValue !== newValue) {
            changes[key] = {
              from: oldValue,
              to: newValue,
            };
          }
        }

        await createAuditLog({
          action: 'issue.updated',
          userId,
          organizationId: issue.organizationId,
          resourceType: 'issue',
          resourceId: issue.id,
          changes,
          metadata: { bulkOperation: true },
        });
      } catch (error) {
        console.error('Failed to create audit log:', error);
      }
    }

    publishEvent('issue.updated', userId, {
      issueId: issue.id,
      projectId: issue.projectId,
      organizationId: issue.organizationId,
      sprintId: issue.sprintId ?? undefined,
    });
    if (issue.sprintId) affectedSprintIds.set(issue.sprintId, issue.organizationId);
    const oldSprint = existingIssues.find((i) => i.id === issue.id)?.sprintId;
    if (oldSprint && oldSprint !== issue.sprintId)
      affectedSprintIds.set(oldSprint, issue.organizationId);
  }

  for (const [sprintId, organizationId] of affectedSprintIds) {
    publishEvent('sprint.issues.changed', userId, { sprintId, organizationId });
  }

  return NextResponse.json({
    success: true,
    updatedCount: updatedIssues.length,
    issues: updatedIssues,
  });
}

/**
 * Handle bulk delete
 */
async function handleBulkDelete(body: any, userId: string) {
  const validatedData = bulkDeleteSchema.parse(body);
  const { issueIds } = validatedData;

  const auth = await assertBulkPermission(userId, issueIds, 'delete');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Verify all issues exist
  const existingIssues = await db.select().from(issues).where(inArray(issues.id, issueIds));

  if (existingIssues.length !== issueIds.length) {
    return NextResponse.json({ error: 'Some issues not found' }, { status: 404 });
  }

  // Delete issues
  await db.delete(issues).where(inArray(issues.id, issueIds));

  // Create audit logs for each deleted issue
  // sprintId -> organizationId, so sprint.issues.changed events carry the org
  // (the SSE stream drops org-less events).
  const affectedSprintIds = new Map<string, string>();
  for (const issue of existingIssues) {
    try {
      await createAuditLog({
        action: 'issue.deleted',
        userId,
        organizationId: issue.organizationId,
        resourceType: 'issue',
        resourceId: issue.id,
        changes: {
          statusId: { from: issue.statusId, to: 'deleted' },
        },
        metadata: { bulkOperation: true },
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }

    publishEvent('issue.deleted', userId, {
      issueId: issue.id,
      projectId: issue.projectId,
      organizationId: issue.organizationId,
      sprintId: issue.sprintId ?? undefined,
    });
    if (issue.sprintId) affectedSprintIds.set(issue.sprintId, issue.organizationId);
  }

  for (const [sprintId, organizationId] of affectedSprintIds) {
    publishEvent('sprint.issues.changed', userId, { sprintId, organizationId });
  }

  return NextResponse.json({
    success: true,
    deletedCount: existingIssues.length,
  });
}
