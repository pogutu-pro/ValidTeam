import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import { agentApprovalEffectOutbox, db } from '@tasknebula/db';
import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';
import { runAutomations } from '@/lib/automation/evaluator';
import { publishEventAwaitingFanOut } from '@/lib/realtime/events';

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const realtimeTypeSchema = z.enum([
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.commented',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.issues.changed',
  'project.created',
  'project.updated',
  'project.deleted',
  'member.added',
  'member.updated',
  'member.removed',
]);

const automationTriggerSchema = z.enum([
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'issue.assigned',
  'sprint.started',
  'sprint.completed',
  'project.created',
  'project.archived',
]);

const approvalEffectSchema = z.object({
  realtime: z.object({
    type: realtimeTypeSchema,
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    issueId: z.string().min(1),
    sprintId: z.string().optional(),
  }),
  automation: z
    .object({
      trigger: automationTriggerSchema,
      organizationId: z.string().min(1),
      projectId: z.string().min(1),
      actorUserId: z.string().min(1),
      payload: z.record(z.unknown()),
    })
    .optional(),
});

type ClaimedEffect = typeof agentApprovalEffectOutbox.$inferSelect;

async function claimEffect(effectId?: string): Promise<ClaimedEffect | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  const lockToken = createId();

  return db.transaction(async (tx) => {
    const conditions = [
      or(
        and(
          eq(agentApprovalEffectOutbox.status, 'pending'),
          lte(agentApprovalEffectOutbox.availableAt, now)
        ),
        and(
          eq(agentApprovalEffectOutbox.status, 'processing'),
          lt(agentApprovalEffectOutbox.lockedAt, staleBefore)
        )
      ),
    ];
    if (effectId) conditions.push(eq(agentApprovalEffectOutbox.id, effectId));

    const [candidate] = await tx
      .select({ id: agentApprovalEffectOutbox.id })
      .from(agentApprovalEffectOutbox)
      .where(and(...conditions))
      .orderBy(asc(agentApprovalEffectOutbox.availableAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(agentApprovalEffectOutbox)
      .set({
        status: 'processing',
        attemptCount: sql`${agentApprovalEffectOutbox.attemptCount} + 1`,
        lockedAt: now,
        lockToken,
        updatedAt: now,
      })
      .where(eq(agentApprovalEffectOutbox.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function acknowledgeEffect(effect: ClaimedEffect): Promise<void> {
  await db
    .update(agentApprovalEffectOutbox)
    .set({
      status: 'completed',
      completedAt: new Date(),
      lockedAt: null,
      lockToken: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentApprovalEffectOutbox.id, effect.id),
        eq(agentApprovalEffectOutbox.workspaceId, effect.workspaceId),
        eq(agentApprovalEffectOutbox.status, 'processing'),
        eq(agentApprovalEffectOutbox.lockToken, effect.lockToken!)
      )
    );
}

async function releaseEffect(effect: ClaimedEffect, error: unknown): Promise<void> {
  const terminal = effect.attemptCount >= MAX_ATTEMPTS;
  const retryDelayMs = Math.min(5 * 60 * 1000, 1000 * 2 ** Math.max(0, effect.attemptCount - 1));
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);

  await db
    .update(agentApprovalEffectOutbox)
    .set({
      status: terminal ? 'failed' : 'pending',
      availableAt: terminal ? effect.availableAt : new Date(Date.now() + retryDelayMs),
      lockedAt: null,
      lockToken: null,
      lastError: message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentApprovalEffectOutbox.id, effect.id),
        eq(agentApprovalEffectOutbox.workspaceId, effect.workspaceId),
        eq(agentApprovalEffectOutbox.status, 'processing'),
        eq(agentApprovalEffectOutbox.lockToken, effect.lockToken!)
      )
    );
}

async function dispatchEffect(effect: ClaimedEffect): Promise<void> {
  const payload = approvalEffectSchema.parse(effect.payload);
  if (payload.realtime.organizationId !== effect.workspaceId) {
    throw new Error('approval_effect_workspace_mismatch');
  }

  // Unlike ordinary request handlers, this durable worker must not ACK while
  // Redis fan-out is still in flight. A rejection releases the leased row for
  // retry; local delivery keeps its synchronous at-least-once semantics.
  await publishEventAwaitingFanOut(payload.realtime.type, payload.realtime.userId, {
    organizationId: payload.realtime.organizationId,
    projectId: payload.realtime.projectId,
    issueId: payload.realtime.issueId,
    sprintId: payload.realtime.sprintId,
  });

  if (payload.automation) {
    if (payload.automation.organizationId !== effect.workspaceId) {
      throw new Error('approval_effect_workspace_mismatch');
    }
    await runAutomations(payload.automation);
  }
}

export type ApprovalEffectProcessSummary = {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
};

/**
 * Drain durable post-commit approval effects.
 *
 * The core approval mutation is exactly-once at the database boundary. Outbox
 * dispatch is at-least-once. The worker awaits Redis acceptance before ACK,
 * but a process can still crash after Redis accepts an event and before the row
 * is acknowledged; lease recovery then publishes it again. Local subscribers
 * can likewise observe a retry more than once. Automation-triggered subscriber
 * webhooks retain the automation engine's independent best-effort contract.
 */
export async function processApprovalEffectOutbox(
  options: {
    effectId?: string;
    limit?: number;
  } = {}
): Promise<ApprovalEffectProcessSummary> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const summary: ApprovalEffectProcessSummary = {
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const effect = await claimEffect(options.effectId);
    if (!effect) break;
    summary.claimed += 1;

    try {
      await dispatchEffect(effect);
      await acknowledgeEffect(effect);
      summary.completed += 1;
    } catch (error) {
      await releaseEffect(effect, error);
      if (effect.attemptCount >= MAX_ATTEMPTS) summary.failed += 1;
      else summary.retried += 1;
    }

    if (options.effectId) break;
  }

  return summary;
}
