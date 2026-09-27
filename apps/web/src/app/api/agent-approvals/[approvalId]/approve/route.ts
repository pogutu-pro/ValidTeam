import { after, NextResponse } from 'next/server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { agentApprovalEffectOutbox, agentApprovalRequests, auditLogs, db } from '@tasknebula/db';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '@/auth';
import { canManageAgentApprovals } from '@/lib/agent-policy/approval-permissions';
import { processApprovalEffectOutbox } from '@/lib/agent-policy/approval-effects';
import { evaluateAgentPolicy } from '@/lib/agent-policy/evaluator';
import { executeApprovedAgentAction } from '@/lib/agent-policy/executors';
import { childLogger } from '@/lib/logger';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import { canCommentOnIssue, canEditIssue } from '@/lib/auth/access-control';

export const dynamic = 'force-dynamic';

const log = childLogger('api/agent-approvals/approve');

async function requesterCanStillExecute(approval: typeof agentApprovalRequests.$inferSelect) {
  if (!approval.projectId) return false;
  const access = await resolveProjectCapabilityAccess(approval.requestedBy, approval.projectId);
  if (!access.canRead || access.project?.organizationId !== approval.workspaceId) return false;

  const executor = (approval.proposedPayload as { executor?: string } | null)?.executor;
  if (executor === 'issues:create') return access.permissions.canCreateIssues;
  if (executor === 'issues:update' && approval.targetId) {
    return (await canEditIssue(approval.requestedBy, approval.targetId)).allowed;
  }
  if (executor === 'comments:create' && approval.targetId) {
    return (await canCommentOnIssue(approval.requestedBy, approval.targetId)).allowed;
  }
  return false;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ approvalId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { approvalId } = await params;
  const [approval] = await db
    .select()
    .from(agentApprovalRequests)
    .where(eq(agentApprovalRequests.id, approvalId))
    .limit(1);

  if (!approval) {
    return NextResponse.json({ error: 'approval_not_found' }, { status: 404 });
  }

  if (
    !(await canManageAgentApprovals({
      userId: session.user.id,
      workspaceId: approval.workspaceId,
      projectId: approval.projectId,
    }))
  ) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (approval.status !== 'pending') {
    return NextResponse.json({ error: 'approval_not_pending' }, { status: 409 });
  }

  const now = new Date();
  if (approval.expiresAt && approval.expiresAt <= now) {
    await db
      .update(agentApprovalRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(eq(agentApprovalRequests.id, approval.id), eq(agentApprovalRequests.status, 'pending'))
      );
    return NextResponse.json({ error: 'approval_expired' }, { status: 410 });
  }

  if (!(await requesterCanStillExecute(approval))) {
    await db
      .update(agentApprovalRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(eq(agentApprovalRequests.id, approval.id), eq(agentApprovalRequests.status, 'pending'))
      );
    return NextResponse.json({ error: 'approval_requester_access_changed' }, { status: 409 });
  }

  const currentPolicy = await evaluateAgentPolicy({
    workspaceId: approval.workspaceId,
    projectId: approval.projectId,
    actor: approval.actor,
    actorType: 'agent',
    resource: approval.resource,
    action: approval.action,
    targetId: approval.targetId,
  });
  if (currentPolicy.decision === 'deny') {
    await db
      .update(agentApprovalRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(eq(agentApprovalRequests.id, approval.id), eq(agentApprovalRequests.status, 'pending'))
      );
    return NextResponse.json({ error: 'approval_policy_changed' }, { status: 409 });
  }

  let applied: {
    approval: typeof agentApprovalRequests.$inferSelect;
    result: Awaited<ReturnType<typeof executeApprovedAgentAction>>['result'];
    effectId: string;
  } | null;
  try {
    applied = await db.transaction(async (tx) => {
      // The claim, domain mutation, approval status, audit row and outbox row
      // commit together. A process crash rolls all of them back to `pending`;
      // concurrent approvers cannot observe or execute a partial claim.
      const [claimed] = await tx
        .update(agentApprovalRequests)
        .set({
          status: 'executing',
          decidedBy: session.user.id,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentApprovalRequests.id, approval.id),
            eq(agentApprovalRequests.status, 'pending'),
            or(isNull(agentApprovalRequests.expiresAt), gt(agentApprovalRequests.expiresAt, now))
          )
        )
        .returning();
      if (!claimed) return null;

      const execution = await executeApprovedAgentAction(claimed, tx);
      const [updated] = await tx
        .update(agentApprovalRequests)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(
          and(
            eq(agentApprovalRequests.id, approval.id),
            eq(agentApprovalRequests.status, 'executing'),
            eq(agentApprovalRequests.decidedBy, session.user.id)
          )
        )
        .returning();
      if (!updated) throw new Error('approval_finalize_failed');

      await tx.insert(auditLogs).values({
        id: createId(),
        userId: session.user.id,
        organizationId: approval.workspaceId,
        action: 'agent.approval.approved',
        resourceType: 'agent_approval',
        resourceId: approval.id,
        projectId: approval.projectId ?? undefined,
        metadata: {
          actor: approval.actor,
          resource: approval.resource,
          action: approval.action,
          targetId: approval.targetId,
        },
      });

      const [effect] = await tx
        .insert(agentApprovalEffectOutbox)
        .values({
          approvalId: approval.id,
          workspaceId: approval.workspaceId,
          effectType: execution.postCommit.realtime.type,
          payload: execution.postCommit,
        })
        .onConflictDoNothing()
        .returning({ id: agentApprovalEffectOutbox.id });
      if (!effect) throw new Error('approval_effect_enqueue_failed');

      return { approval: updated, result: execution.result, effectId: effect.id };
    });
  } catch (error) {
    log.error({ err: error, approvalId: approval.id }, 'approved agent action failed');
    // The transaction rolled the claim and domain mutation back. Record a
    // terminal failure only if the row is still pending; no partial DB effect
    // can accompany this transition.
    await db
      .update(agentApprovalRequests)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(eq(agentApprovalRequests.id, approval.id), eq(agentApprovalRequests.status, 'pending'))
      );
    return NextResponse.json({ error: 'approval_execution_failed' }, { status: 500 });
  }

  if (!applied) {
    return NextResponse.json({ error: 'approval_not_pending' }, { status: 409 });
  }

  // Fast-path the durable outbox after the response is committed. A scheduled
  // reconciler reclaims pending or abandoned leased rows if this process exits.
  after(async () => {
    await processApprovalEffectOutbox({ effectId: applied.effectId, limit: 1 }).catch((error) => {
      log.error({ err: error, effectId: applied.effectId }, 'approval effect dispatch failed');
    });
  });

  return NextResponse.json({ approval: applied.approval, result: applied.result });
}
