import {
  ROLE_DEFAULT_PERMISSIONS,
  db,
  issueStatusHistory,
  issues,
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  users,
  workflows,
  workflowStatuses,
  workflowTransitions,
  type ProjectRole,
} from '@validteam/db';
import { and, eq, inArray } from 'drizzle-orm';

export type WorkflowPolicyRole = 'admin' | 'member' | 'guest';
export type IssueTransitionDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WorkflowTransitionErrorCode =
  | 'workflow_transition_issue_not_found'
  | 'workflow_transition_workflow_not_found'
  | 'workflow_transition_status_invalid'
  | 'workflow_transition_not_allowed'
  | 'workflow_transition_actor_forbidden'
  | 'workflow_transition_approval_required'
  | 'workflow_transition_policy_invalid'
  | 'workflow_transition_policy_unsupported'
  | 'workflow_transition_relationship_invalid'
  | 'workflow_transition_conflict';

const ERROR_STATUS: Record<WorkflowTransitionErrorCode, number> = {
  workflow_transition_issue_not_found: 404,
  workflow_transition_workflow_not_found: 409,
  workflow_transition_status_invalid: 400,
  workflow_transition_not_allowed: 409,
  workflow_transition_actor_forbidden: 403,
  workflow_transition_approval_required: 409,
  workflow_transition_policy_invalid: 422,
  workflow_transition_policy_unsupported: 422,
  workflow_transition_relationship_invalid: 400,
  workflow_transition_conflict: 409,
};

export class WorkflowTransitionError extends Error {
  readonly code: WorkflowTransitionErrorCode;
  readonly httpStatus: number;

  constructor(code: WorkflowTransitionErrorCode) {
    super(code);
    this.name = 'WorkflowTransitionError';
    this.code = code;
    this.httpStatus = ERROR_STATUS[code];
  }
}

export function isWorkflowTransitionError(error: unknown): error is WorkflowTransitionError {
  return error instanceof WorkflowTransitionError;
}

type IssueRow = typeof issues.$inferSelect;

export type PreparedIssueStatusTransition = {
  issue: IssueRow;
  workflowId: string;
  fromStatusId: string;
  toStatusId: string;
  changed: boolean;
  transitionId: string | null;
};

export type PrepareIssueStatusTransitionInput = {
  organizationId: string;
  projectId: string;
  issueId: string;
  toStatusId: string;
  actorUserId: string;
  /** Reserved for trusted internal jobs whose configured DB user is the audit actor. */
  actorKind?: 'user' | 'system';
  expectedFromStatusId?: string;
};

function policyRoleForOrganizationRole(
  role: typeof organizationMembers.$inferSelect.role
): WorkflowPolicyRole {
  if (role === 'owner' || role === 'admin') return 'admin';
  if (role === 'member') return 'member';
  return 'guest';
}

function assertRoleList(
  value: unknown,
  allowed: ReadonlySet<string>,
  allowEmpty = false
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((role) => typeof role !== 'string' || !allowed.has(role))
  ) {
    throw new WorkflowTransitionError('workflow_transition_policy_invalid');
  }
}

function assertUnsupportedCollectionIsEmpty(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new WorkflowTransitionError('workflow_transition_policy_invalid');
  }
  if (value.length > 0) {
    throw new WorkflowTransitionError('workflow_transition_policy_unsupported');
  }
}

function permissionValue(value: string | null | undefined, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

async function resolveWorkflowId(
  tx: IssueTransitionDbTransaction,
  project: Pick<typeof projects.$inferSelect, 'defaultWorkflowId' | 'organizationId'>,
  currentStatusId: string
): Promise<string> {
  const [workflow] = project.defaultWorkflowId
    ? await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(
            eq(workflows.id, project.defaultWorkflowId),
            eq(workflows.organizationId, project.organizationId)
          )
        )
        .limit(1)
    : await tx
        .select({ id: workflows.id })
        .from(workflowStatuses)
        .innerJoin(
          workflows,
          and(
            eq(workflows.id, workflowStatuses.workflowId),
            eq(workflows.organizationId, project.organizationId)
          )
        )
        .where(eq(workflowStatuses.id, currentStatusId))
        .limit(1);
  if (!workflow) {
    throw new WorkflowTransitionError('workflow_transition_workflow_not_found');
  }
  return workflow.id;
}

/**
 * Resolve a category through the project's selected workflow, never merely an
 * organization-wide status. Call this inside the same transaction that will
 * prepare/apply the transition.
 */
export async function resolveProjectWorkflowStatusByCategory(
  tx: IssueTransitionDbTransaction,
  input: {
    organizationId: string;
    projectId: string;
    issueId: string;
    category: typeof workflowStatuses.$inferSelect.category;
  }
): Promise<string | null> {
  const [project] = await tx
    .select({
      organizationId: projects.organizationId,
      defaultWorkflowId: projects.defaultWorkflowId,
      currentStatusId: issues.statusId,
    })
    .from(projects)
    .innerJoin(
      issues,
      and(
        eq(issues.id, input.issueId),
        eq(issues.projectId, projects.id),
        eq(issues.organizationId, projects.organizationId)
      )
    )
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
    .limit(1)
    .for('update');
  if (!project) {
    throw new WorkflowTransitionError('workflow_transition_issue_not_found');
  }
  const workflowId = await resolveWorkflowId(tx, project, project.currentStatusId);
  const [status] = await tx
    .select({ id: workflowStatuses.id })
    .from(workflowStatuses)
    .where(
      and(
        eq(workflowStatuses.workflowId, workflowId),
        eq(workflowStatuses.category, input.category)
      )
    )
    .orderBy(workflowStatuses.position)
    .limit(1);
  return status?.id ?? null;
}

/**
 * Canonical, tenant-scoped transition policy gate. The issue row is locked so
 * the returned preparation remains valid until the caller's transaction ends.
 * Callers must prepare every member of a bulk operation before mutating any of
 * them; a later rejection then rolls the whole transaction back cleanly.
 */
export async function prepareIssueStatusTransition(
  tx: IssueTransitionDbTransaction,
  input: PrepareIssueStatusTransitionInput
): Promise<PreparedIssueStatusTransition> {
  const [context] = await tx
    .select({ issue: issues, project: projects, organizationStatus: organizations.status })
    .from(issues)
    .innerJoin(
      projects,
      and(eq(projects.id, issues.projectId), eq(projects.organizationId, issues.organizationId))
    )
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(
      and(
        eq(issues.id, input.issueId),
        eq(issues.organizationId, input.organizationId),
        eq(issues.projectId, input.projectId),
        eq(projects.organizationId, input.organizationId)
      )
    )
    .limit(1)
    .for('update');

  if (!context || context.organizationStatus === 'suspended') {
    throw new WorkflowTransitionError('workflow_transition_issue_not_found');
  }
  if (
    input.expectedFromStatusId !== undefined &&
    context.issue.statusId !== input.expectedFromStatusId
  ) {
    throw new WorkflowTransitionError('workflow_transition_conflict');
  }

  const workflowId = await resolveWorkflowId(tx, context.project, context.issue.statusId);
  const statusIds = Array.from(new Set([context.issue.statusId, input.toStatusId]));
  const statusRows = await tx
    .select({ id: workflowStatuses.id })
    .from(workflowStatuses)
    .where(
      and(eq(workflowStatuses.workflowId, workflowId), inArray(workflowStatuses.id, statusIds))
    );
  if (statusRows.length !== statusIds.length) {
    throw new WorkflowTransitionError('workflow_transition_status_invalid');
  }

  if (context.issue.statusId === input.toStatusId) {
    return {
      issue: context.issue,
      workflowId,
      fromStatusId: context.issue.statusId,
      toStatusId: input.toStatusId,
      changed: false,
      transitionId: null,
    };
  }

  const matchingTransitions = await tx
    .select()
    .from(workflowTransitions)
    .where(
      and(
        eq(workflowTransitions.workflowId, workflowId),
        eq(workflowTransitions.fromStatusId, context.issue.statusId),
        eq(workflowTransitions.toStatusId, input.toStatusId)
      )
    )
    .limit(2);
  const transition = matchingTransitions[0];
  if (!transition) {
    throw new WorkflowTransitionError('workflow_transition_not_allowed');
  }
  if (matchingTransitions.length !== 1) {
    throw new WorkflowTransitionError('workflow_transition_policy_invalid');
  }

  const policyRoles = new Set(['admin', 'member', 'guest']);
  assertRoleList(transition.allowedRoles, policyRoles);

  const [actor] = await tx
    .select({ id: users.id, isSuperAdmin: users.isSuperAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, input.actorUserId))
    .limit(1);
  if (!actor || actor.status !== 'active') {
    throw new WorkflowTransitionError('workflow_transition_actor_forbidden');
  }

  const isSystemActor = input.actorKind === 'system';
  let actorRole: WorkflowPolicyRole | null = actor.isSuperAdmin || isSystemActor ? 'admin' : null;
  let organizationRole: typeof organizationMembers.$inferSelect.role | null = null;
  if (!actorRole) {
    const [membership] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, input.actorUserId),
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.status, 'active')
        )
      )
      .limit(1);
    organizationRole = membership?.role ?? null;
    actorRole = membership ? policyRoleForOrganizationRole(membership.role) : null;
  }
  if (!actorRole || !transition.allowedRoles.includes(actorRole)) {
    throw new WorkflowTransitionError('workflow_transition_actor_forbidden');
  }

  // The persisted workflow role is an additional policy layer, not a
  // substitute for project authorization. Human actors must either be an
  // organization owner/admin or hold canTransitionIssues in this project.
  // Trusted internal jobs and superadmins are explicit service-level escapes;
  // they still have to satisfy the transition's persisted `admin` role.
  if (
    !actor.isSuperAdmin &&
    !isSystemActor &&
    organizationRole !== 'owner' &&
    organizationRole !== 'admin'
  ) {
    const [projectMembership] = await tx
      .select({
        role: projectMembers.role,
        canTransitionIssues: projectMembers.canTransitionIssues,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, input.actorUserId),
          eq(projectMembers.projectId, input.projectId)
        )
      )
      .limit(1);
    if (!projectMembership) {
      throw new WorkflowTransitionError('workflow_transition_actor_forbidden');
    }
    const roleDefaults =
      ROLE_DEFAULT_PERMISSIONS[projectMembership.role as ProjectRole] ??
      ROLE_DEFAULT_PERMISSIONS.viewer;
    if (!permissionValue(projectMembership.canTransitionIssues, roleDefaults.canTransitionIssues)) {
      throw new WorkflowTransitionError('workflow_transition_actor_forbidden');
    }
  }

  // Conditions, validators and post-actions have no typed execution language
  // yet. Silently ignoring persisted policy would be a bypass, so any value
  // other than the well-defined empty collection rejects the transition.
  assertUnsupportedCollectionIsEmpty(transition.conditions);
  assertUnsupportedCollectionIsEmpty(transition.validators);
  assertUnsupportedCollectionIsEmpty(transition.postActions);

  if (transition.requiresApproval) {
    assertRoleList(transition.approverRoles, new Set(['admin', 'member']));
    if (!transition.approvedTargetStatusId || !transition.rejectedTargetStatusId) {
      throw new WorkflowTransitionError('workflow_transition_policy_invalid');
    }
    const approvalTargets = Array.from(
      new Set([transition.approvedTargetStatusId, transition.rejectedTargetStatusId])
    );
    const targetRows = await tx
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.workflowId, workflowId),
          inArray(workflowStatuses.id, approvalTargets)
        )
      );
    if (targetRows.length !== approvalTargets.length) {
      throw new WorkflowTransitionError('workflow_transition_policy_invalid');
    }
    // The workflow policy does not yet have a durable approval request/apply
    // worker. A different agent-policy approval must not satisfy this rule.
    throw new WorkflowTransitionError('workflow_transition_approval_required');
  }
  if (transition.approvedTargetStatusId || transition.rejectedTargetStatusId) {
    throw new WorkflowTransitionError('workflow_transition_policy_invalid');
  }

  return {
    issue: context.issue,
    workflowId,
    fromStatusId: context.issue.statusId,
    toStatusId: input.toStatusId,
    changed: true,
    transitionId: transition.id,
  };
}

/** Apply a previously locked/prepared transition and append history atomically. */
export async function applyPreparedIssueStatusTransition(
  tx: IssueTransitionDbTransaction,
  input: {
    prepared: PreparedIssueStatusTransition;
    actorUserId: string;
    reason: string;
    patch?: Partial<typeof issues.$inferInsert>;
    skipWriteWhenUnchanged?: boolean;
  }
): Promise<IssueRow> {
  const { prepared } = input;
  if (!prepared.changed && input.skipWriteWhenUnchanged !== false) {
    return prepared.issue;
  }

  const safePatch = { ...(input.patch ?? {}) };
  delete safePatch.id;
  delete safePatch.organizationId;
  delete safePatch.projectId;
  delete safePatch.statusId;

  const [updated] = await tx
    .update(issues)
    .set({
      ...safePatch,
      statusId: prepared.toStatusId,
      updatedBy: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(issues.id, prepared.issue.id),
        eq(issues.organizationId, prepared.issue.organizationId),
        eq(issues.projectId, prepared.issue.projectId),
        eq(issues.statusId, prepared.fromStatusId)
      )
    )
    .returning();
  if (!updated) {
    throw new WorkflowTransitionError('workflow_transition_conflict');
  }

  if (prepared.changed) {
    await tx.insert(issueStatusHistory).values({
      issueId: prepared.issue.id,
      fromStatus: prepared.fromStatusId,
      toStatus: prepared.toStatusId,
      changedByUserId: input.actorUserId,
      reason: input.reason,
    });
  }
  return updated;
}

/**
 * Bulk orchestration keeps the crucial two-phase invariant in one place:
 * lock/prepare every issue first, then apply. A policy error on item N can
 * therefore never leave items 1..N-1 mutated.
 */
export async function applyBulkIssueStatusTransitions(
  tx: IssueTransitionDbTransaction,
  input: {
    issues: Array<{ organizationId: string; projectId: string; issueId: string }>;
    toStatusId: string;
    actorUserId: string;
    reason: string;
    patch?: Partial<typeof issues.$inferInsert>;
  }
): Promise<{ before: IssueRow[]; after: IssueRow[] }> {
  const prepared: PreparedIssueStatusTransition[] = [];
  for (const identity of [...input.issues].sort((left, right) =>
    left.issueId.localeCompare(right.issueId)
  )) {
    prepared.push(
      await prepareIssueStatusTransition(tx, {
        ...identity,
        toStatusId: input.toStatusId,
        actorUserId: input.actorUserId,
      })
    );
  }

  const after: IssueRow[] = [];
  for (const entry of prepared) {
    after.push(
      await applyPreparedIssueStatusTransition(tx, {
        prepared: entry,
        actorUserId: input.actorUserId,
        reason: input.reason,
        patch: input.patch,
        skipWriteWhenUnchanged: false,
      })
    );
  }
  return { before: prepared.map((entry) => entry.issue), after };
}
