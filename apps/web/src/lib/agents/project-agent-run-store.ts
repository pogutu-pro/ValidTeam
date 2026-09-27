import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { createTranslator } from 'next-intl';
import {
  agentRuns,
  agentRunStepEvents,
  auditLogs,
  db,
  notifications,
  organizations,
  users,
} from '@tasknebula/db';
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { defaultLocale, isSupportedLocale } from '@/lib/i18n/config';
import type { GraphCheckpoint, GraphEvent } from './graph-runtime';
import type {
  ProjectAgentCheckpoint,
  ProjectAgentGraphState,
  ProjectAgentLogEntry,
  ProjectAgentNodeName,
} from './project-agent-graph';
import { PROJECT_AGENT_GRAPH_VERSION } from './project-agent-graph';
import type { AgentRunKind, EffectiveProjectAgentSettings } from './config';
import type { AgentWriteDisposition } from './execution-policy';
import type { AgentModelConfigSettings } from './model-configs';

const LEASE_MS = 30_000;
const HEARTBEAT_MS = 5_000;

export const PROJECT_AGENT_BOUNDS = {
  maxSteps: 6,
  maxVisitsPerNode: 2,
  maxRuntimeMs: 120_000,
  maxConsecutiveNoProgress: 2,
} as const;

// The deadline is an absolute wall-clock fence. Keeping it equal to the graph
// runtime bound prevents repeated crash/reclaim cycles from resetting a fresh
// 120 second execution window on every worker.
const DEFAULT_DEADLINE_MS = PROJECT_AGENT_BOUNDS.maxRuntimeMs;

export type DurableProjectAgentInput = {
  kind: AgentRunKind;
  projectKey: string;
  requestedDryRun: boolean;
  forcedDryRun: boolean;
  approvalRequired: boolean;
  writeDisposition: AgentWriteDisposition;
  effectiveSettings: EffectiveProjectAgentSettings;
  modelConfig: {
    id: string;
    name: string;
    revisionCount: number;
    settings: AgentModelConfigSettings;
  } | null;
};

export type DurableAgentRun = typeof agentRuns.$inferSelect;

export type PublicProjectAgentRun = Pick<
  DurableAgentRun,
  | 'id'
  | 'projectId'
  | 'kind'
  | 'status'
  | 'dryRun'
  | 'summary'
  | 'writeActionsCount'
  | 'output'
  | 'logs'
  | 'createdAt'
  | 'updatedAt'
  | 'startedAt'
  | 'completedAt'
  | 'mode'
>;

function serializeProjectAgentOutput(run: DurableAgentRun): Record<string, unknown> {
  const output = (run.output as Record<string, unknown> | null) ?? {};
  // Internal/provider errors are intentionally retained only on agent_runs.
  // Browser consumers receive the stable errorCode/httpStatus contract.
  const { error: _internalError, ...safeOutput } = output;
  return safeOutput;
}

/** Browser-safe projection. Durable checkpoints, leases and request metadata stay server-only. */
export function serializeProjectAgentRun(run: DurableAgentRun): PublicProjectAgentRun {
  return {
    id: run.id,
    projectId: run.projectId,
    kind: run.kind,
    status: run.status,
    dryRun: run.dryRun,
    summary: run.summary,
    writeActionsCount: run.writeActionsCount,
    output: serializeProjectAgentOutput(run),
    logs: run.logs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    mode: run.mode,
  };
}

const WRITE_DISPOSITIONS = new Set<AgentWriteDisposition>([
  'read_only',
  'preview_requested',
  'preview_writes_disabled',
  'preview_approval_required',
  'live',
]);

export function serializeProjectAgentRunEnvelope(run: DurableAgentRun) {
  const input = (run.input ?? {}) as Partial<DurableProjectAgentInput>;
  const output = serializeProjectAgentOutput(run);
  const writeDisposition = WRITE_DISPOSITIONS.has(input.writeDisposition as AgentWriteDisposition)
    ? (input.writeDisposition as AgentWriteDisposition)
    : run.dryRun
      ? 'preview_requested'
      : 'live';
  return {
    run: serializeProjectAgentRun(run),
    output,
    dryRun: run.dryRun,
    forcedDryRun: input.forcedDryRun === true,
    approvalRequired: input.approvalRequired === true,
    writeDisposition,
  };
}

export class ProjectAgentIdempotencyConflict extends Error {
  constructor() {
    super('The idempotency key was already used for a different project agent request.');
    this.name = 'ProjectAgentIdempotencyConflict';
  }
}

export class ProjectAgentAdmissionError extends Error {
  constructor(
    public readonly code: 'daily_limit_reached' | 'concurrency_limit_reached',
    message: string
  ) {
    super(message);
    this.name = 'ProjectAgentAdmissionError';
  }
}

export class ProjectAgentResumeConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectAgentResumeConflict';
  }
}

export class ProjectAgentLeaseLost extends Error {
  constructor() {
    super('Project agent run lease was lost.');
    this.name = 'ProjectAgentLeaseLost';
  }
}

export function isProjectAgentLeaseLost(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof ProjectAgentLeaseLost) return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}

class ProjectAgentCancelled extends Error {
  constructor() {
    super('Project agent run was cancelled.');
    this.name = 'ProjectAgentCancelled';
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashProjectAgentRequest(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function getUtcAgentQuotaDayStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function getProjectAgentDeadline(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_DEADLINE_MS);
}

export function classifyProjectAgentGuardMiss(
  current: {
    status: DurableAgentRun['status'];
    cancelRequestedAt: Date | null;
  } | null
): 'cancelled' | 'lease_lost' {
  return current?.status === 'cancelled' || current?.cancelRequestedAt ? 'cancelled' : 'lease_lost';
}

export async function getLocalizedRunFailureCopy(run: DurableAgentRun) {
  try {
    const [user] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, run.initiatedBy))
      .limit(1);
    const locale = isSupportedLocale(user?.locale) ? user.locale : defaultLocale;
    const messages = (await import(`../../../messages/${locale}.json`)).default as Record<
      string,
      unknown
    >;
    const t = createTranslator({
      locale,
      messages,
      namespace: 'settingsConfig.agentShared.runMessages',
    }) as unknown as (key: string) => string;
    return {
      summary: t('agentRunFailed'),
      title: `${t('agentRunFailed')} · ${t(`kinds.${run.kind}`)}`,
      message: t('agentRunFailed'),
    };
  } catch (error) {
    // Failure persistence is authoritative. A catalog/runtime problem must not
    // strand the run in `running`; omit the optional notification instead.
    console.error('Failed to localize project agent failure notification:', error);
    return null;
  }
}

export function hashProjectAgentIngressRequest(params: {
  projectId: string;
  initiatedBy: string;
  kind: AgentRunKind;
  requestedDryRun: boolean;
}): string {
  return hashProjectAgentRequest(params);
}

export async function findDurableProjectAgentRunReplay(params: {
  organizationId: string;
  projectId: string;
  initiatedBy: string;
  idempotencyKey: string;
  kind: AgentRunKind;
  requestedDryRun: boolean;
}): Promise<DurableAgentRun | null> {
  const [existing] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.organizationId, params.organizationId),
        eq(agentRuns.idempotencyKey, params.idempotencyKey)
      )
    )
    .limit(1);
  if (!existing) return null;
  const expectedHash = hashProjectAgentIngressRequest({
    projectId: params.projectId,
    initiatedBy: params.initiatedBy,
    kind: params.kind,
    requestedDryRun: params.requestedDryRun,
  });
  if (
    existing.requestHash !== expectedHash ||
    existing.projectId !== params.projectId ||
    existing.initiatedBy !== params.initiatedBy
  ) {
    throw new ProjectAgentIdempotencyConflict();
  }
  return existing;
}

export async function startDurableProjectAgentRun(params: {
  organizationId: string;
  projectId: string;
  initiatedBy: string;
  kind: AgentRunKind;
  mode: DurableAgentRun['mode'];
  dryRun: boolean;
  requestedDryRun: boolean;
  idempotencyKey: string;
  input: DurableProjectAgentInput;
  dailyRunLimit: number;
  maxConcurrentRuns: number;
}): Promise<{ run: DurableAgentRun; created: boolean }> {
  const requestHash = hashProjectAgentIngressRequest({
    projectId: params.projectId,
    initiatedBy: params.initiatedBy,
    kind: params.kind,
    requestedDryRun: params.requestedDryRun,
  });
  const now = new Date();
  const startOfDay = getUtcAgentQuotaDayStart(now);
  // The product has no workspace-timezone field yet. A single UTC boundary is
  // deterministic across replicas; UI/docs label this quota accordingly.

  return db.transaction(async (tx) => {
    // Serialize admission across app instances. Replay is checked again after
    // acquiring the lock, so a duplicate never consumes quota or starts work.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('project-agent-admission'))`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`project-agent-org:${params.organizationId}`}))`
    );

    const [existing] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.organizationId, params.organizationId),
          eq(agentRuns.idempotencyKey, params.idempotencyKey)
        )
      )
      .limit(1);
    if (existing) {
      if (
        existing.requestHash !== requestHash ||
        existing.projectId !== params.projectId ||
        existing.initiatedBy !== params.initiatedBy
      ) {
        throw new ProjectAgentIdempotencyConflict();
      }
      return { run: existing, created: false };
    }

    const [daily] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.organizationId, params.organizationId),
          gte(agentRuns.createdAt, startOfDay)
        )
      );
    const [active] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(inArray(agentRuns.status, ['pending', 'running']));
    if ((daily?.total ?? 0) >= params.dailyRunLimit) {
      throw new ProjectAgentAdmissionError(
        'daily_limit_reached',
        `Daily agent run limit reached (${params.dailyRunLimit}).`
      );
    }
    if ((active?.total ?? 0) >= params.maxConcurrentRuns) {
      throw new ProjectAgentAdmissionError(
        'concurrency_limit_reached',
        'Too many agent runs are already in progress. Try again in a moment.'
      );
    }

    const [created] = await tx
      .insert(agentRuns)
      .values({
        id: createId(),
        organizationId: params.organizationId,
        projectId: params.projectId,
        initiatedBy: params.initiatedBy,
        kind: params.kind,
        mode: params.mode,
        dryRun: params.dryRun,
        status: 'pending',
        input: params.input,
        output: {},
        logs: [],
        idempotencyKey: params.idempotencyKey,
        requestHash,
        graphVersion: PROJECT_AGENT_GRAPH_VERSION,
        currentNode: 'load_context',
        checkpointVersion: 0,
        completedSteps: 0,
        lastEventSequence: 1,
        ...PROJECT_AGENT_BOUNDS,
        deadlineAt: getProjectAgentDeadline(now),
        startedAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(agentRunStepEvents).values({
      id: createId(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      runId: created!.id,
      sequence: 1,
      eventType: 'run_accepted',
      node: 'load_context',
      step: 0,
      payload: { graphVersion: PROJECT_AGENT_GRAPH_VERSION },
    });
    await tx.insert(auditLogs).values({
      id: createId(),
      userId: params.initiatedBy,
      organizationId: params.organizationId,
      action: 'agent.run_requested',
      resourceType: 'project_ai_agents',
      resourceId: params.projectId,
      projectId: params.projectId,
      metadata: {
        kind: params.kind,
        dryRun: params.dryRun,
        idempotencyKey: params.idempotencyKey,
        runId: created!.id,
      },
    });
    return { run: created!, created: true };
  });
}

async function claimRun(params: {
  workerId: string;
  runId?: string;
  organizationId?: string;
  projectId?: string;
}): Promise<DurableAgentRun | null> {
  const now = new Date();
  const conditions = [
    eq(agentRuns.graphVersion, PROJECT_AGENT_GRAPH_VERSION),
    or(
      eq(agentRuns.status, 'pending'),
      and(
        eq(agentRuns.status, 'running'),
        or(isNull(agentRuns.leaseExpiresAt), lt(agentRuns.leaseExpiresAt, now))
      )
    )!,
  ];
  if (params.runId) conditions.push(eq(agentRuns.id, params.runId));
  if (params.organizationId) conditions.push(eq(agentRuns.organizationId, params.organizationId));
  if (params.projectId) conditions.push(eq(agentRuns.projectId, params.projectId));

  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(...conditions))
      .orderBy(asc(agentRuns.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(agentRuns)
      .set({
        status: 'running',
        leaseOwner: params.workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        heartbeatAt: now,
        error: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(agentRuns.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function heartbeatRun(run: DurableAgentRun, workerId: string) {
  const now = new Date();
  const [heartbeat] = await db
    .update(agentRuns)
    .set({
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, run.id),
        eq(agentRuns.organizationId, run.organizationId),
        eq(agentRuns.status, 'running'),
        eq(agentRuns.leaseOwner, workerId),
        gt(agentRuns.leaseExpiresAt, now),
        isNull(agentRuns.cancelRequestedAt)
      )
    )
    .returning({ cancelRequestedAt: agentRuns.cancelRequestedAt });

  if (!heartbeat) throw new ProjectAgentLeaseLost();
  if (heartbeat.cancelRequestedAt) throw new ProjectAgentCancelled();
}

function startHeartbeat(run: DurableAgentRun, workerId: string, controller: AbortController) {
  let stopped = false;
  let active: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      active = heartbeatRun(run, workerId)
        .catch((error) => controller.abort(error))
        .finally(schedule);
    }, HEARTBEAT_MS);
    timer.unref?.();
  };
  schedule();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

function graphEventFields(event: GraphEvent<ProjectAgentNodeName>) {
  return {
    node: 'node' in event ? event.node : null,
    step: event.step,
    attempt: event.type === 'node_started' || event.type === 'node_retrying' ? event.attempt : null,
  };
}

async function appendRunEvent(params: {
  run: DurableAgentRun;
  workerId: string;
  event: GraphEvent<ProjectAgentNodeName>;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [advanced] = await tx
      .update(agentRuns)
      .set({
        lastEventSequence: sql`${agentRuns.lastEventSequence} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.id, params.run.id),
          eq(agentRuns.organizationId, params.run.organizationId),
          eq(agentRuns.status, 'running'),
          eq(agentRuns.leaseOwner, params.workerId),
          gt(agentRuns.leaseExpiresAt, now),
          isNull(agentRuns.cancelRequestedAt)
        )
      )
      .returning({ sequence: agentRuns.lastEventSequence });
    if (!advanced) throw new ProjectAgentLeaseLost();

    const fields = graphEventFields(params.event);
    await tx.insert(agentRunStepEvents).values({
      id: createId(),
      organizationId: params.run.organizationId,
      projectId: params.run.projectId,
      runId: params.run.id,
      sequence: advanced.sequence,
      eventType: params.event.type,
      node: fields.node,
      step: fields.step,
      attempt: fields.attempt,
      payload: params.event,
    });
  });
}

async function persistRunCheckpoint(params: {
  run: DurableAgentRun;
  workerId: string;
  expectedVersion: number;
  checkpoint: ProjectAgentCheckpoint;
}): Promise<number> {
  const now = new Date();
  const [persisted] = await db
    .update(agentRuns)
    .set({
      graphVersion: params.checkpoint.graphVersion,
      currentNode: params.checkpoint.currentNode,
      checkpoint: params.checkpoint,
      checkpointVersion: params.expectedVersion + 1,
      completedSteps: params.checkpoint.completedSteps,
      logs: params.checkpoint.state.logs,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, params.run.id),
        eq(agentRuns.organizationId, params.run.organizationId),
        eq(agentRuns.status, 'running'),
        eq(agentRuns.leaseOwner, params.workerId),
        gt(agentRuns.leaseExpiresAt, now),
        eq(agentRuns.checkpointVersion, params.expectedVersion),
        isNull(agentRuns.cancelRequestedAt)
      )
    )
    .returning({ version: agentRuns.checkpointVersion });
  if (!persisted) throw new ProjectAgentLeaseLost();
  return persisted.version;
}

export type ProjectAgentRunCompletion = {
  checkpoint: ProjectAgentCheckpoint;
  logs: ProjectAgentLogEntry[];
  summary: string;
  output: Record<string, unknown>;
  writeActionsCount: number;
};

export type ProjectAgentLeaseContext = {
  leaseOwner: string;
  signal: AbortSignal;
  checkpoint: ProjectAgentCheckpoint | undefined;
  remainingRuntimeMs: number;
  persistCheckpoint: (checkpoint: ProjectAgentCheckpoint) => Promise<void>;
  appendEvent: (event: GraphEvent<ProjectAgentNodeName>) => Promise<void>;
};

async function finishRun(params: {
  run: DurableAgentRun;
  workerId: string;
  completion: ProjectAgentRunCompletion;
}): Promise<DurableAgentRun> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(agentRuns)
      .set({
        status: 'completed',
        currentNode: params.completion.checkpoint.currentNode,
        checkpoint: params.completion.checkpoint,
        completedSteps: params.completion.checkpoint.completedSteps,
        logs: params.completion.logs,
        summary: params.completion.summary,
        output: params.completion.output,
        writeActionsCount: params.completion.writeActionsCount,
        error: null,
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.id, params.run.id),
          eq(agentRuns.organizationId, params.run.organizationId),
          eq(agentRuns.status, 'running'),
          eq(agentRuns.leaseOwner, params.workerId),
          gt(agentRuns.leaseExpiresAt, now),
          isNull(agentRuns.cancelRequestedAt)
        )
      )
      .returning();
    if (!completed) {
      const [current] = await tx
        .select({
          status: agentRuns.status,
          cancelRequestedAt: agentRuns.cancelRequestedAt,
        })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, params.run.id),
            eq(agentRuns.organizationId, params.run.organizationId),
            eq(agentRuns.projectId, params.run.projectId!)
          )
        )
        .limit(1);
      if (classifyProjectAgentGuardMiss(current ?? null) === 'cancelled') {
        throw new ProjectAgentCancelled();
      }
      throw new ProjectAgentLeaseLost();
    }
    await tx.insert(auditLogs).values({
      id: createId(),
      userId: params.run.initiatedBy,
      organizationId: params.run.organizationId,
      action: 'agent.run_completed',
      resourceType: 'agent_run',
      resourceId: params.run.id,
      projectId: params.run.projectId,
      changes: { status: { from: 'running', to: 'completed' } },
      metadata: {
        kind: params.run.kind,
        dryRun: params.run.dryRun,
        writeActionsCount: params.completion.writeActionsCount,
      },
    });
    return completed;
  });
}

async function markRunStopped(params: {
  run: DurableAgentRun;
  workerId: string;
  status: 'failed' | 'cancelled';
  error: string;
  logs?: ProjectAgentLogEntry[];
  errorCode?: string;
  httpStatus?: number;
}) {
  const now = new Date();
  const localizedCopy =
    params.status === 'failed' ? await getLocalizedRunFailureCopy(params.run) : null;
  return db.transaction(async (tx) => {
    const [stopped] = await tx
      .update(agentRuns)
      .set({
        status: params.status,
        error: params.error.slice(0, 2000),
        summary: localizedCopy?.summary ?? null,
        output: {
          error: params.error,
          errorCode: params.errorCode ?? 'agent_run_failed',
          httpStatus: params.httpStatus ?? 500,
        },
        logs: params.logs,
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.id, params.run.id),
          eq(agentRuns.organizationId, params.run.organizationId),
          eq(agentRuns.status, 'running'),
          eq(agentRuns.leaseOwner, params.workerId),
          gt(agentRuns.leaseExpiresAt, now),
          isNull(agentRuns.cancelRequestedAt)
        )
      )
      .returning();
    if (stopped) {
      await tx.insert(auditLogs).values({
        id: createId(),
        userId: params.run.initiatedBy,
        organizationId: params.run.organizationId,
        action: params.status === 'cancelled' ? 'agent.run_cancelled' : 'agent.run_failed',
        resourceType: 'agent_run',
        resourceId: params.run.id,
        projectId: params.run.projectId,
        changes: { status: { from: 'running', to: params.status } },
        metadata: { kind: params.run.kind, error: params.error },
      });
      if (params.status === 'failed' && localizedCopy) {
        await tx.insert(notifications).values({
          id: createId(),
          userId: params.run.initiatedBy,
          type: 'agent_run_failed',
          title: localizedCopy.title,
          message: localizedCopy.message,
          projectId: params.run.projectId,
          actorType: 'agent',
        });
      }
    }
    if (!stopped) throw new ProjectAgentLeaseLost();
    return stopped ?? null;
  });
}

export type ProjectAgentRunProcessSummary = {
  claimed: number;
  completed: number;
  failed: number;
  cancelled: number;
};

async function failIncompatibleActiveRuns(params: {
  limit: number;
  runId?: string;
  organizationId?: string;
  projectId?: string;
}): Promise<number> {
  const rows = await db.transaction(async (tx) => {
    const conditions = [
      inArray(agentRuns.status, ['pending', 'running']),
      or(
        isNull(agentRuns.graphVersion),
        sql`${agentRuns.graphVersion} <> ${PROJECT_AGENT_GRAPH_VERSION}`
      )!,
    ];
    if (params.runId) conditions.push(eq(agentRuns.id, params.runId));
    if (params.organizationId) conditions.push(eq(agentRuns.organizationId, params.organizationId));
    if (params.projectId) conditions.push(eq(agentRuns.projectId, params.projectId));
    const candidates = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(...conditions))
      .orderBy(asc(agentRuns.createdAt))
      .limit(params.limit)
      .for('update', { skipLocked: true });
    if (candidates.length === 0) return [];

    const now = new Date();
    const failed: DurableAgentRun[] = [];
    for (const candidate of candidates) {
      const [run] = await tx
        .update(agentRuns)
        .set({
          status: 'failed',
          error: 'Project agent graph version is unsupported by this deployment.',
          summary: null,
          output: {
            error: 'Project agent graph version is unsupported by this deployment.',
            errorCode: 'graph_version_mismatch',
            httpStatus: 409,
          },
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(agentRuns.id, candidate.id), inArray(agentRuns.status, ['pending', 'running']))
        )
        .returning();
      if (!run) continue;
      failed.push(run);
      await tx.insert(agentRunStepEvents).values({
        id: createId(),
        organizationId: run.organizationId,
        projectId: run.projectId,
        runId: run.id,
        sequence: run.lastEventSequence + 1,
        eventType: 'run_failed',
        node: run.currentNode,
        step: run.completedSteps,
        payload: { code: 'GRAPH_CHECKPOINT_VERSION_MISMATCH' },
      });
      await tx
        .update(agentRuns)
        .set({ lastEventSequence: run.lastEventSequence + 1 })
        .where(eq(agentRuns.id, run.id));
      await tx.insert(auditLogs).values({
        id: createId(),
        userId: run.initiatedBy,
        organizationId: run.organizationId,
        action: 'agent.run_failed',
        resourceType: 'agent_run',
        resourceId: run.id,
        projectId: run.projectId,
        changes: { status: { from: run.status, to: 'failed' } },
        metadata: { kind: run.kind, errorCode: 'graph_version_mismatch' },
      });
    }
    return failed;
  });
  return rows.length;
}

export async function processDurableProjectAgentRuns(params: {
  runId?: string;
  organizationId?: string;
  projectId?: string;
  limit?: number;
  execute: (
    run: DurableAgentRun,
    lease: ProjectAgentLeaseContext
  ) => Promise<ProjectAgentRunCompletion>;
  classifyError?: (error: unknown) => { errorCode: string; httpStatus: number };
}): Promise<{ summary: ProjectAgentRunProcessSummary; run: DurableAgentRun | null }> {
  const limit = Math.min(25, Math.max(1, params.limit ?? 10));
  const summary: ProjectAgentRunProcessSummary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  let lastRun: DurableAgentRun | null = null;

  summary.failed += await failIncompatibleActiveRuns({
    limit,
    runId: params.runId,
    organizationId: params.organizationId,
    projectId: params.projectId,
  });

  for (let index = 0; index < limit; index += 1) {
    const workerId = createId();
    const run = await claimRun({
      workerId,
      runId: params.runId,
      organizationId: params.organizationId,
      projectId: params.projectId,
    });
    if (!run) break;
    summary.claimed += 1;
    lastRun = run;

    const controller = new AbortController();
    const stopHeartbeat = startHeartbeat(run, workerId, controller);
    let checkpointVersion = run.checkpointVersion;
    const checkpoint = (run.checkpoint ?? undefined) as ProjectAgentCheckpoint | undefined;
    const remainingRuntimeMs = Math.max(
      1,
      Math.min(
        run.maxRuntimeMs,
        (run.deadlineAt?.getTime() ?? Date.now() + run.maxRuntimeMs) - Date.now()
      )
    );

    try {
      if (run.deadlineAt && run.deadlineAt.getTime() <= Date.now()) {
        throw new Error('Project agent run exceeded its durable deadline.');
      }
      const completion = await params.execute(run, {
        leaseOwner: workerId,
        signal: controller.signal,
        checkpoint,
        remainingRuntimeMs,
        persistCheckpoint: async (nextCheckpoint) => {
          checkpointVersion = await persistRunCheckpoint({
            run,
            workerId,
            expectedVersion: checkpointVersion,
            checkpoint: nextCheckpoint,
          });
        },
        appendEvent: (event) => appendRunEvent({ run, workerId, event }),
      });
      lastRun = await finishRun({ run, workerId, completion });
      summary.completed += 1;
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (isProjectAgentLeaseLost(reason) || isProjectAgentLeaseLost(error)) {
        // Another worker owns the recovery lease; its result is authoritative.
      } else {
        const cancelled = reason instanceof ProjectAgentCancelled;
        const message = reason instanceof Error ? reason.message : String(reason);
        const classification = params.classifyError?.(reason);
        const checkpointLogs = ((
          error as { checkpoint?: GraphCheckpoint<ProjectAgentGraphState, ProjectAgentNodeName> }
        )?.checkpoint?.state.logs ?? checkpoint?.state.logs) as ProjectAgentLogEntry[] | undefined;
        try {
          lastRun = await markRunStopped({
            run,
            workerId,
            status: cancelled ? 'cancelled' : 'failed',
            error: message,
            logs: checkpointLogs,
            errorCode: classification?.errorCode,
            httpStatus: classification?.httpStatus,
          });
          if (cancelled) summary.cancelled += 1;
          else summary.failed += 1;
        } catch (stopError) {
          if (!isProjectAgentLeaseLost(stopError)) throw stopError;
          // The failure happened after this worker's lease expired or moved;
          // another owner is authoritative and this batch must not count it.
        }
      }
    } finally {
      await stopHeartbeat();
    }

    if (params.runId) break;
  }

  return { summary, run: lastRun };
}

export async function requestProjectAgentRunCancellation(params: {
  runId: string;
  organizationId: string;
  projectId: string;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, params.runId),
          eq(agentRuns.organizationId, params.organizationId),
          eq(agentRuns.projectId, params.projectId)
        )
      )
      .limit(1)
      .for('update');
    if (!run) return null;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return run;
    }

    const [updated] = await tx
      .update(agentRuns)
      .set({
        status: 'cancelled',
        cancelRequestedAt: now,
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, ['pending', 'running'])))
      .returning();
    if (updated) {
      const nextSequence = run.lastEventSequence + 1;
      await tx.insert(agentRunStepEvents).values({
        id: createId(),
        organizationId: run.organizationId,
        projectId: run.projectId,
        runId: run.id,
        sequence: nextSequence,
        eventType: 'run_cancelled',
        node: run.currentNode,
        step: run.completedSteps,
        payload: { previousStatus: run.status },
      });
      await tx
        .update(agentRuns)
        .set({ lastEventSequence: nextSequence })
        .where(eq(agentRuns.id, run.id));
      await tx.insert(auditLogs).values({
        id: createId(),
        userId: run.initiatedBy,
        organizationId: run.organizationId,
        action: 'agent.run_cancelled',
        resourceType: 'agent_run',
        resourceId: run.id,
        projectId: run.projectId,
        changes: { status: { from: run.status, to: 'cancelled' } },
        metadata: { kind: run.kind, cancelled: true },
      });
    }
    return updated ?? null;
  });
}

export async function resumeProjectAgentRun(params: {
  runId: string;
  organizationId: string;
  projectId: string;
  maxConcurrentRuns: number;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    // Resume shares the same global admission lock/order as a new start. It
    // does not consume the daily quota again, but it must reserve an active
    // slot atomically with concurrent starts and resumes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('project-agent-admission'))`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`project-agent-org:${params.organizationId}`}))`
    );
    const [current] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, params.runId),
          eq(agentRuns.organizationId, params.organizationId),
          eq(agentRuns.projectId, params.projectId)
        )
      )
      .limit(1)
      .for('update');
    if (!current) return null;
    if (current.status !== 'failed' && current.status !== 'cancelled') {
      throw new ProjectAgentResumeConflict('Only failed or cancelled agent runs can be resumed.');
    }
    const checkpoint = current.checkpoint as ProjectAgentCheckpoint | null;
    if (
      current.graphVersion !== PROJECT_AGENT_GRAPH_VERSION ||
      (checkpoint && checkpoint.graphVersion !== PROJECT_AGENT_GRAPH_VERSION)
    ) {
      throw new ProjectAgentResumeConflict(
        'This run checkpoint belongs to an unsupported graph version and cannot be resumed.'
      );
    }
    const [active] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(inArray(agentRuns.status, ['pending', 'running']));
    if ((active?.total ?? 0) >= params.maxConcurrentRuns) {
      throw new ProjectAgentAdmissionError(
        'concurrency_limit_reached',
        'Too many agent runs are already in progress. Try again in a moment.'
      );
    }
    const [run] = await tx
      .update(agentRuns)
      .set({
        status: 'pending',
        summary: null,
        output: {},
        writeActionsCount: 0,
        cancelRequestedAt: null,
        completedAt: null,
        error: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        deadlineAt: getProjectAgentDeadline(now),
        lastEventSequence: current.lastEventSequence + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.id, params.runId),
          eq(agentRuns.organizationId, params.organizationId),
          eq(agentRuns.projectId, params.projectId),
          or(eq(agentRuns.status, 'failed'), eq(agentRuns.status, 'cancelled'))
        )
      )
      .returning();
    if (!run) return null;
    await tx.insert(agentRunStepEvents).values({
      id: createId(),
      organizationId: run.organizationId,
      projectId: run.projectId,
      runId: run.id,
      sequence: current.lastEventSequence + 1,
      eventType: 'run_resumed',
      node: run.currentNode,
      step: run.completedSteps,
      payload: { previousStatus: current.status },
    });
    return run;
  });
}

export async function getProjectAgentRun(params: {
  runId: string;
  organizationId: string;
  projectId: string;
}) {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, params.runId),
        eq(agentRuns.organizationId, params.organizationId),
        eq(agentRuns.projectId, params.projectId)
      )
    )
    .limit(1);
  return run ?? null;
}

export async function loadAgentOrganizationSettings(organizationId: string) {
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return (organization?.settings as Record<string, unknown> | null | undefined) ?? null;
}
