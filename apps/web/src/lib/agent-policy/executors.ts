import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import {
  auditLogs,
  db,
  eq,
  issueActivities,
  issueComments,
  issues,
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  sprints,
  workflowStatuses,
  workflows,
  users,
  type AgentApprovalRequest,
} from '@validteam/db';
import { and, desc, ne, sql } from 'drizzle-orm';
import { syncIssueLabelsWithExecutor } from '@/lib/labels/sync';
import type { RealtimeEventType } from '@/lib/realtime/events';
import type { AutomationTrigger } from '@/lib/automation/evaluator';
import type { AgentApprovalExecutor } from './types';
import {
  applyPreparedIssueStatusTransition,
  prepareIssueStatusTransition,
  type PreparedIssueStatusTransition,
} from '@/lib/workflows/issue-transition-policy';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const issueTypeSchema = z.enum(['story', 'task', 'bug', 'epic']);
const issuePrioritySchema = z.enum(['critical', 'high', 'medium', 'low', 'none']);

const createIssuePayloadSchema = z.object({
  projectId: z.string().min(1),
  type: issueTypeSchema,
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  priority: issuePrioritySchema.default('medium'),
  assigneeId: z.string().optional().nullable(),
  labels: z.array(z.string()).default([]),
  sprintId: z.string().optional().nullable(),
  epicId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  estimate: z.number().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  customFields: z.record(z.unknown()).default({}),
  statusId: z.string().optional().nullable(),
});

const updateIssuePayloadSchema = z.object({
  issueId: z.string().min(1),
  data: z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().optional().nullable(),
    statusId: z.string().optional(),
    priority: issuePrioritySchema.optional(),
    assigneeId: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
    sprintId: z.string().nullable().optional(),
    resolution: z
      .enum(['fixed', 'wont_do', 'duplicate', 'cannot_reproduce', 'done'])
      .nullable()
      .optional(),
  }),
});

const createCommentPayloadSchema = z.object({
  issueId: z.string().min(1),
  data: z.object({
    content: z.string().min(1),
    parentId: z.string().optional().nullable(),
    mentions: z.array(z.string()).default([]),
    isInternal: z.boolean().default(false),
  }),
});

type StoredExecutorPayload = {
  executor: AgentApprovalExecutor;
  data: Record<string, unknown>;
};

export type AgentApprovalPostCommitEffect = {
  realtime: {
    type: RealtimeEventType;
    userId: string;
    organizationId: string;
    projectId: string;
    issueId: string;
    sprintId?: string;
  };
  automation?: {
    trigger: AutomationTrigger;
    organizationId: string;
    projectId: string;
    actorUserId: string;
    payload: Record<string, unknown>;
  };
};

export type ApprovedAgentActionExecution = {
  result: typeof issues.$inferSelect | typeof issueComments.$inferSelect;
  postCommit: AgentApprovalPostCommitEffect;
};

function isSupportedExecutor(value: unknown): value is AgentApprovalExecutor {
  return value === 'issues:create' || value === 'issues:update' || value === 'comments:create';
}

function getExecutorPayload(approval: AgentApprovalRequest): StoredExecutorPayload {
  const payload = approval.proposedPayload as {
    executor?: string;
    data?: Record<string, unknown>;
  } | null;
  if (!isSupportedExecutor(payload?.executor) || !payload.data) {
    throw new Error('approval_payload_invalid');
  }
  return {
    executor: payload.executor,
    data: payload.data,
  };
}

async function resolveWorkflowId(
  tx: DbTransaction,
  project: Pick<typeof projects.$inferSelect, 'defaultWorkflowId' | 'organizationId'>
): Promise<string> {
  if (project.defaultWorkflowId) return project.defaultWorkflowId;

  const [workflow] = await tx
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.organizationId, project.organizationId), eq(workflows.isDefault, true)))
    .limit(1);
  if (!workflow) throw new Error('workflow_not_found');
  return workflow.id;
}

async function validateIssueRelationships(
  tx: DbTransaction,
  input: {
    organizationId: string;
    projectId: string;
    assigneeId?: string | null;
    sprintId?: string | null;
    epicId?: string | null;
    parentId?: string | null;
  }
): Promise<void> {
  if (input.assigneeId) {
    const [member] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.userId, input.assigneeId),
          eq(organizationMembers.status, 'active'),
          eq(users.status, 'active'),
          ne(organizations.status, 'suspended')
        )
      )
      .limit(1);
    if (!member) throw new Error('assignee_not_found');

    const [projectMember] = await tx
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, input.projectId),
          eq(projectMembers.userId, input.assigneeId)
        )
      )
      .limit(1);
    if (!projectMember) throw new Error('assignee_not_found');
  }

  if (input.sprintId) {
    const [sprint] = await tx
      .select({ id: sprints.id })
      .from(sprints)
      .where(and(eq(sprints.id, input.sprintId), eq(sprints.projectId, input.projectId)))
      .limit(1);
    if (!sprint) throw new Error('sprint_not_found');
  }

  for (const relation of [
    { id: input.epicId, error: 'epic_not_found' },
    { id: input.parentId, error: 'parent_issue_not_found' },
  ]) {
    if (!relation.id) continue;
    const [relatedIssue] = await tx
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.id, relation.id),
          eq(issues.organizationId, input.organizationId),
          eq(issues.projectId, input.projectId)
        )
      )
      .limit(1);
    if (!relatedIssue) throw new Error(relation.error);
  }
}

async function createActivity(
  tx: DbTransaction,
  data: {
    issueId: string;
    userId: string;
    type: 'created' | 'updated' | 'status_changed' | 'assigned' | 'commented';
    metadata?: Record<string, unknown>;
  }
) {
  await tx.insert(issueActivities).values({
    id: createId(),
    issueId: data.issueId,
    userId: data.userId,
    type: data.type,
    metadata: data.metadata ?? {},
    createdBy: data.userId,
    updatedBy: data.userId,
  });
}

async function createIssueAudit(
  tx: DbTransaction,
  data: {
    userId: string;
    organizationId: string;
    action:
      | 'issue.created'
      | 'issue.updated'
      | 'issue.status_changed'
      | 'issue.assigned'
      | 'issue.labels_changed'
      | 'issue.priority_changed'
      | 'issue.commented';
    issueId: string;
    projectId: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
    metadata: Record<string, unknown>;
  }
) {
  await tx.insert(auditLogs).values({
    id: createId(),
    userId: data.userId,
    organizationId: data.organizationId,
    action: data.action,
    resourceType: 'issue',
    resourceId: data.issueId,
    issueId: data.issueId,
    projectId: data.projectId,
    changes: data.changes,
    metadata: data.metadata,
  });
}

async function executeIssueCreate(
  approval: AgentApprovalRequest,
  data: Record<string, unknown>,
  tx: DbTransaction
): Promise<ApprovedAgentActionExecution> {
  const input = createIssuePayloadSchema.parse(data);
  if (approval.projectId && approval.projectId !== input.projectId) {
    throw new Error('project_not_found');
  }

  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, approval.workspaceId)))
    .limit(1);
  if (!project) throw new Error('project_not_found');

  await validateIssueRelationships(tx, {
    organizationId: approval.workspaceId,
    projectId: project.id,
    assigneeId: input.assigneeId,
    sprintId: input.sprintId,
    epicId: input.epicId,
    parentId: input.parentId,
  });

  const workflowId = await resolveWorkflowId(tx, project);
  const allStatuses = await tx
    .select()
    .from(workflowStatuses)
    .where(eq(workflowStatuses.workflowId, workflowId));

  let finalStatusId: string | undefined;
  if (input.statusId) {
    const suppliedStatus = allStatuses.find((status) => status.id === input.statusId);
    if (!suppliedStatus) throw new Error('status_not_found');
    finalStatusId = suppliedStatus.id;
  } else {
    finalStatusId = [...allStatuses]
      .filter((status) => status.category === 'backlog')
      .sort((left, right) => left.position - right.position)[0]?.id;
  }
  if (!finalStatusId) throw new Error('status_not_found');

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${project.id}))`);
  const [lastIssue] = await tx
    .select({ number: issues.number })
    .from(issues)
    .where(eq(issues.projectId, project.id))
    .orderBy(desc(issues.number))
    .limit(1);

  const nextNumber = lastIssue ? (lastIssue.number || 0) + 1 : 1;
  const [newIssue] = await tx
    .insert(issues)
    .values({
      id: createId(),
      organizationId: project.organizationId,
      projectId: project.id,
      key: `${project.key}-${nextNumber}`,
      number: nextNumber,
      title: input.title,
      description: input.description || null,
      statusId: finalStatusId,
      priority: input.priority,
      type: input.type,
      reporterId: approval.requestedBy,
      assigneeId: input.assigneeId || null,
      sprintId: input.sprintId || null,
      epicId: input.epicId || null,
      parentId: input.parentId || null,
      estimate: input.estimate ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      labels: input.labels,
      customFields: input.customFields,
      metadata: { source: 'agent_policy_approval', approvalRequestId: approval.id },
      createdBy: approval.requestedBy,
      updatedBy: approval.requestedBy,
    })
    .returning();
  if (!newIssue) throw new Error('issue_create_failed');

  if (input.labels.length > 0) {
    await syncIssueLabelsWithExecutor(
      {
        organizationId: newIssue.organizationId,
        issueId: newIssue.id,
        labels: input.labels,
        createdBy: approval.requestedBy,
      },
      tx
    );
  }

  await createActivity(tx, {
    issueId: newIssue.id,
    userId: approval.requestedBy,
    type: 'created',
  });
  await createIssueAudit(tx, {
    userId: approval.requestedBy,
    organizationId: newIssue.organizationId,
    action: 'issue.created',
    issueId: newIssue.id,
    projectId: newIssue.projectId,
    metadata: {
      source: 'agent_policy_approval',
      approvalRequestId: approval.id,
      actor: approval.actor,
      issueKey: newIssue.key,
    },
  });

  return {
    result: newIssue,
    postCommit: {
      realtime: {
        type: 'issue.created',
        userId: approval.requestedBy,
        projectId: newIssue.projectId,
        issueId: newIssue.id,
        sprintId: newIssue.sprintId || undefined,
        organizationId: newIssue.organizationId,
      },
      automation: {
        trigger: 'issue.created',
        organizationId: newIssue.organizationId,
        projectId: newIssue.projectId,
        payload: newIssue,
        actorUserId: approval.requestedBy,
      },
    },
  };
}

async function executeIssueUpdate(
  approval: AgentApprovalRequest,
  data: Record<string, unknown>,
  tx: DbTransaction
): Promise<ApprovedAgentActionExecution> {
  const input = updateIssuePayloadSchema.parse(data);
  if (approval.targetId && approval.targetId !== input.issueId) {
    throw new Error('issue_not_found');
  }
  const [currentIssue] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.organizationId, approval.workspaceId)))
    .limit(1);
  if (!currentIssue) throw new Error('issue_not_found');
  if (approval.projectId && currentIssue.projectId !== approval.projectId) {
    throw new Error('issue_not_found');
  }

  const [project] = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, currentIssue.projectId),
        eq(projects.organizationId, approval.workspaceId)
      )
    )
    .limit(1);
  if (!project) throw new Error('project_not_found');

  await validateIssueRelationships(tx, {
    organizationId: approval.workspaceId,
    projectId: currentIssue.projectId,
    assigneeId: input.data.assigneeId,
    sprintId: input.data.sprintId,
  });

  let preparedTransition: PreparedIssueStatusTransition | null = null;
  if (input.data.statusId) {
    const workflowId = await resolveWorkflowId(tx, project);
    const [validStatus] = await tx
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.id, input.data.statusId),
          eq(workflowStatuses.workflowId, workflowId)
        )
      )
      .limit(1);
    if (!validStatus) throw new Error('status_not_found');
    preparedTransition = await prepareIssueStatusTransition(tx, {
      organizationId: approval.workspaceId,
      projectId: currentIssue.projectId,
      issueId: input.issueId,
      toStatusId: input.data.statusId,
      actorUserId: approval.requestedBy,
      expectedFromStatusId: currentIssue.statusId,
    });
  }

  const patch = {
    ...input.data,
    ...(input.data.resolution !== undefined
      ? { resolvedAt: input.data.resolution === null ? null : new Date() }
      : {}),
    updatedBy: approval.requestedBy,
    updatedAt: new Date(),
  };
  const updated = preparedTransition
    ? await applyPreparedIssueStatusTransition(tx, {
        prepared: preparedTransition,
        actorUserId: approval.requestedBy,
        reason: 'agent_policy_approval',
        patch,
        skipWriteWhenUnchanged: false,
      })
    : (
        await tx
          .update(issues)
          .set(patch)
          .where(and(eq(issues.id, input.issueId), eq(issues.organizationId, approval.workspaceId)))
          .returning()
      )[0];
  if (!updated) throw new Error('issue_update_failed');

  if (input.data.labels !== undefined) {
    await syncIssueLabelsWithExecutor(
      {
        organizationId: currentIssue.organizationId,
        issueId: input.issueId,
        labels: input.data.labels,
        createdBy: approval.requestedBy,
      },
      tx
    );
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    'statusId',
    'assigneeId',
    'priority',
    'title',
    'labels',
    'resolution',
  ] as const) {
    if (input.data[key] === undefined) continue;
    const before = currentIssue[key];
    const afterValue = input.data[key];
    if (JSON.stringify(before) !== JSON.stringify(afterValue)) {
      changes[key] = { from: before ?? null, to: afterValue ?? null };
    }
  }

  if (Object.keys(changes).length > 0) {
    let action:
      | 'issue.status_changed'
      | 'issue.assigned'
      | 'issue.labels_changed'
      | 'issue.priority_changed'
      | 'issue.updated' = 'issue.updated';
    if (changes.statusId) action = 'issue.status_changed';
    else if (changes.assigneeId) action = 'issue.assigned';
    else if (changes.labels) action = 'issue.labels_changed';
    else if (changes.priority) action = 'issue.priority_changed';

    await createActivity(tx, {
      issueId: input.issueId,
      userId: approval.requestedBy,
      type: changes.statusId ? 'status_changed' : changes.assigneeId ? 'assigned' : 'updated',
      metadata: { source: 'agent_policy_approval', approvalRequestId: approval.id },
    });
    await createIssueAudit(tx, {
      userId: approval.requestedBy,
      organizationId: currentIssue.organizationId,
      action,
      issueId: input.issueId,
      projectId: currentIssue.projectId,
      changes,
      metadata: {
        source: 'agent_policy_approval',
        approvalRequestId: approval.id,
        actor: approval.actor,
      },
    });
  }

  return {
    result: updated,
    postCommit: {
      realtime: {
        type: 'issue.updated',
        userId: approval.requestedBy,
        projectId: currentIssue.projectId,
        issueId: input.issueId,
        sprintId: updated.sprintId || undefined,
        organizationId: currentIssue.organizationId,
      },
      automation: {
        trigger: 'issue.updated',
        organizationId: currentIssue.organizationId,
        projectId: currentIssue.projectId,
        payload: { before: currentIssue, after: updated, changedFields: Object.keys(changes) },
        actorUserId: approval.requestedBy,
      },
    },
  };
}

async function executeCommentCreate(
  approval: AgentApprovalRequest,
  data: Record<string, unknown>,
  tx: DbTransaction
): Promise<ApprovedAgentActionExecution> {
  const input = createCommentPayloadSchema.parse(data);
  if (approval.targetId && approval.targetId !== input.issueId) {
    throw new Error('issue_not_found');
  }
  const [issue] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.organizationId, approval.workspaceId)))
    .limit(1);
  if (!issue) throw new Error('issue_not_found');
  if (approval.projectId && issue.projectId !== approval.projectId) {
    throw new Error('issue_not_found');
  }

  if (input.data.parentId) {
    const [parentComment] = await tx
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(
        and(eq(issueComments.id, input.data.parentId), eq(issueComments.issueId, input.issueId))
      )
      .limit(1);
    if (!parentComment) throw new Error('parent_comment_not_found');
  }

  const [comment] = await tx
    .insert(issueComments)
    .values({
      id: createId(),
      issueId: input.issueId,
      content: input.data.content,
      parentId: input.data.parentId || null,
      mentions: input.data.mentions,
      reactions: [],
      isInternal: input.data.isInternal ? 'true' : 'false',
      createdBy: approval.requestedBy,
      updatedBy: approval.requestedBy,
    })
    .returning();
  if (!comment) throw new Error('comment_create_failed');

  await createActivity(tx, {
    issueId: input.issueId,
    userId: approval.requestedBy,
    type: 'commented',
    metadata: { source: 'agent_policy_approval', approvalRequestId: approval.id },
  });
  await createIssueAudit(tx, {
    userId: approval.requestedBy,
    organizationId: issue.organizationId,
    action: 'issue.commented',
    issueId: input.issueId,
    projectId: issue.projectId,
    metadata: {
      source: 'agent_policy_approval',
      approvalRequestId: approval.id,
      actor: approval.actor,
      commentId: comment.id,
    },
  });

  return {
    result: comment,
    postCommit: {
      realtime: {
        type: 'issue.commented',
        userId: approval.requestedBy,
        issueId: input.issueId,
        projectId: issue.projectId,
        organizationId: issue.organizationId,
      },
    },
  };
}

/**
 * Apply the approval's database effect using the caller's transaction. No
 * network/process side effect is performed here: the route stores postCommit
 * in the durable outbox before it marks the approval approved.
 */
export async function executeApprovedAgentAction(
  approval: AgentApprovalRequest,
  tx: DbTransaction
): Promise<ApprovedAgentActionExecution> {
  const payload = getExecutorPayload(approval);
  switch (payload.executor) {
    case 'issues:create':
      return executeIssueCreate(approval, payload.data, tx);
    case 'issues:update':
      return executeIssueUpdate(approval, payload.data, tx);
    case 'comments:create':
      return executeCommentCreate(approval, payload.data, tx);
    default:
      throw new Error('approval_executor_unsupported');
  }
}
