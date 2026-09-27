/**
 * Real-Postgres verification of the production durable project-agent store
 * and effect implementation. Run only against a disposable migrated database.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  applyProjectAgentIssueEffect,
  processProjectAgentRunQueue,
  runProjectAgent,
} from '../src/lib/agents/engine';
import {
  ProjectAgentAdmissionError,
  processDurableProjectAgentRuns,
  resumeProjectAgentRun,
  startDurableProjectAgentRun,
  type DurableProjectAgentInput,
  type ProjectAgentRunCompletion,
} from '../src/lib/agents/project-agent-run-store';
import {
  DEFAULT_PROJECT_AGENT_SETTINGS,
  DEFAULT_SYSTEM_AGENT_CONTROL_SETTINGS,
  DEFAULT_WORKSPACE_AGENT_SETTINGS,
  resolveEffectiveProjectAgentSettings,
} from '../src/lib/agents/config';
import {
  createInitialProjectAgentState,
  PROJECT_AGENT_GRAPH_VERSION,
} from '../src/lib/agents/project-agent-graph';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl || !process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required; refusing to run against an implicit database');
}

const sql = postgres(databaseUrl, { max: 8 });
const suffix = randomUUID().replaceAll('-', '');
const ids = {
  organization: `runtime_org_${suffix}`,
  user: `runtime_user_${suffix}`,
  project: `runtime_project_${suffix}`,
  workflow: `runtime_workflow_${suffix}`,
  status: `runtime_status_${suffix}`,
  issue: `runtime_issue_${suffix}`,
  humanSprint: `runtime_sprint_${suffix}`,
  systemSetting: `runtime_system_${suffix}`,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workspaceSettings = {
  ...DEFAULT_WORKSPACE_AGENT_SETTINGS,
  enabled: true,
  allowWriteActions: true,
  requireApprovalForWrites: false,
  aiOversight: 'auto' as const,
  dailyRunLimit: 100,
  capabilities: {
    project_tracking: true,
    backlog_triage: true,
    sprint_planning: true,
    bulk_sprint_creation: true,
  },
};
const projectSettings = {
  ...DEFAULT_PROJECT_AGENT_SETTINGS,
  enabled: true,
  allowWriteActions: true,
  sprintBatchSize: 1,
  issueCapacityPerSprint: 3,
  capabilities: {
    project_tracking: true,
    backlog_triage: true,
    sprint_planning: true,
    bulk_sprint_creation: true,
  },
};
const systemControl = {
  ...DEFAULT_SYSTEM_AGENT_CONTROL_SETTINGS,
  globalEnabled: true,
  allowWriteActions: true,
  requireSupervisionForAutoMode: false,
  maxConcurrentRuns: 50,
};
const effectiveSettings = resolveEffectiveProjectAgentSettings(
  workspaceSettings,
  projectSettings,
  systemControl
);

function durableInput(kind: DurableProjectAgentInput['kind']): DurableProjectAgentInput {
  return {
    kind,
    projectKey: 'RTE',
    requestedDryRun: false,
    forcedDryRun: false,
    approvalRequired: false,
    writeDisposition: kind === 'project_tracking' ? 'read_only' : 'live',
    effectiveSettings,
    modelConfig: null,
  };
}

function completion(writeActionsCount: number): ProjectAgentRunCompletion {
  const state = createInitialProjectAgentState('backlog_triage');
  return {
    checkpoint: {
      graphVersion: PROJECT_AGENT_GRAPH_VERSION,
      currentNode: '__end__',
      state,
      completedSteps: 3,
      nodeVisits: { load_context: 1, plan: 1, execute: 1 },
      repeatedProgressCount: 0,
      lastProgressKey: 'integration-complete',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    logs: [],
    summary: 'integration complete',
    output: { verified: true },
    writeActionsCount,
  };
}

async function startRun(key: string, kind: DurableProjectAgentInput['kind'] = 'backlog_triage') {
  return startDurableProjectAgentRun({
    organizationId: ids.organization,
    projectId: ids.project,
    initiatedBy: ids.user,
    kind,
    mode: 'manual',
    dryRun: false,
    requestedDryRun: false,
    idempotencyKey: key,
    input: durableInput(kind),
    dailyRunLimit: 100,
    maxConcurrentRuns: 50,
  });
}

function issueEffect(params: {
  runId: string;
  leaseOwner: string;
  signal: AbortSignal;
  effectKey: string;
  expectedPriority?: 'none' | 'low' | 'medium' | 'high' | 'critical';
  nextPriority?: 'none' | 'low' | 'medium' | 'high' | 'critical';
  expectedSprintId?: string | null;
  nextSprintId?: string | null;
  kind?: 'backlog_triage' | 'bulk_sprint_creation';
}) {
  const sprintEffect = params.kind === 'bulk_sprint_creation';
  return applyProjectAgentIssueEffect({
    runId: params.runId,
    organizationId: ids.organization,
    projectId: ids.project,
    issueId: ids.issue,
    userId: ids.user,
    leaseOwner: params.leaseOwner,
    signal: params.signal,
    kind: params.kind ?? 'backlog_triage',
    effectKey: params.effectKey,
    effectType: sprintEffect ? 'sprint_assign_issue' : 'issue_triage',
    effectPayload: sprintEffect
      ? { issueId: ids.issue, sprintId: params.nextSprintId }
      : { issueId: ids.issue, priority: params.nextPriority, labels: [] },
    expected: sprintEffect
      ? { sprintId: params.expectedSprintId ?? null }
      : { priority: params.expectedPriority ?? 'medium', labels: [] },
    set: sprintEffect
      ? { sprintId: params.nextSprintId ?? null }
      : { priority: params.nextPriority ?? 'high', labels: [] },
    activity: {
      type: 'updated',
      field: sprintEffect ? 'sprintId' : 'priority',
      oldValue: sprintEffect
        ? (params.expectedSprintId ?? null)
        : (params.expectedPriority ?? 'medium'),
      newValue: sprintEffect ? (params.nextSprintId ?? null) : (params.nextPriority ?? 'high'),
      metadata: { source: 'agent', runId: params.runId },
    },
    audit: {
      action: sprintEffect ? 'sprint.issue_added' : 'issue.priority_changed',
      resourceType: sprintEffect ? 'sprint' : 'issue',
      resourceId: sprintEffect ? (params.nextSprintId ?? ids.humanSprint) : ids.issue,
      changes: {},
      metadata: { source: 'agent', runId: params.runId },
    },
    staleMessage: 'integration stale context',
  });
}

async function main() {
  await sql.begin(async (tx) => {
    await tx`insert into users (id, email, locale) values (${ids.user}, ${`runtime-${suffix}@example.test`}, 'en')`;
    await tx`
      insert into organizations (id, name, slug, settings)
      values (${ids.organization}, 'Runtime integration', ${`runtime-${suffix}`}, ${JSON.stringify({ aiAgents: workspaceSettings })}::jsonb)
    `;
    await tx`
      insert into projects (id, organization_id, key, name, settings, created_by, updated_by)
      values (${ids.project}, ${ids.organization}, 'RTE', 'Runtime integration', ${JSON.stringify({ aiAgents: projectSettings })}::jsonb, ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into workflows (id, organization_id, name, is_default, created_by, updated_by)
      values (${ids.workflow}, ${ids.organization}, 'Runtime workflow', true, ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into workflow_statuses (id, workflow_id, name, category, color, position)
      values (${ids.status}, ${ids.workflow}, 'Backlog', 'backlog', '#000000', 0)
    `;
    await tx`
      insert into issues (
        id, organization_id, project_id, key, number, type, title, status_id,
        priority, labels, reporter_id, created_by, updated_by
      ) values (
        ${ids.issue}, ${ids.organization}, ${ids.project}, 'RTE-1', 1, 'task',
        'Runtime fencing target', ${ids.status}, 'medium', '[]'::jsonb,
        ${ids.user}, ${ids.user}, ${ids.user}
      )
    `;
    await tx`
      insert into sprints (id, project_id, name, start_date, end_date, created_by, updated_by)
      values (${ids.humanSprint}, ${ids.project}, 'Human sprint', now(), now() + interval '7 days', ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into system_settings (id, key, value, category, updated_by)
      values (${ids.systemSetting}, 'agent_control_center', ${JSON.stringify(systemControl)}::jsonb, 'features', ${ids.user})
    `;
  });

  try {
    const duplicate = await Promise.all([
      startRun('duplicate-request'),
      startRun('duplicate-request'),
    ]);
    assert(
      duplicate.filter((result) => result.created).length === 1,
      'duplicate request created twice'
    );
    assert(
      duplicate[0]!.run.id === duplicate[1]!.run.id,
      'duplicate request returned different runs'
    );
    const [requestRows] = await sql<{ events: number; audits: number }[]>`
      select
        (select count(*)::int from agent_run_step_events where run_id = ${duplicate[0]!.run.id}) as events,
        (select count(*)::int from audit_logs where action = 'agent.run_requested' and metadata->>'runId' = ${duplicate[0]!.run.id}) as audits
    `;
    assert(
      requestRows?.events === 1 && requestRows.audits === 1,
      'idempotent replay duplicated observability'
    );

    await processDurableProjectAgentRuns({
      runId: duplicate[0]!.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:once',
        });
        throw new Error('simulated crash after committed effect');
      },
    });
    await sql`
      update agent_runs
      set summary = 'stale failure',
          output = '{"error":"internal","errorCode":"agent_run_failed"}'::jsonb,
          write_actions_count = 9
      where id = ${duplicate[0]!.run.id}
    `;
    const [runsBeforeResume] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_runs where organization_id = ${ids.organization}
    `;
    const acceptedResume = await resumeProjectAgentRun({
      runId: duplicate[0]!.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      maxConcurrentRuns: 50,
    });
    assert(acceptedResume?.status === 'pending', 'failed run was not accepted for resume');
    assert(acceptedResume.summary === null, 'resume exposed a stale failure summary');
    assert(
      Object.keys((acceptedResume.output ?? {}) as Record<string, unknown>).length === 0,
      'resume exposed stale failure output'
    );
    assert(acceptedResume.writeActionsCount === 0, 'resume exposed a stale effect count');
    const [runsAfterResume] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_runs where organization_id = ${ids.organization}
    `;
    assert(
      runsAfterResume?.total === runsBeforeResume?.total,
      'resume consumed daily quota by creating a second run'
    );
    const resumed = await processDurableProjectAgentRuns({
      runId: duplicate[0]!.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        const applied = await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:once',
        });
        assert(applied === false, 'resume repeated an already committed effect');
        return completion(1);
      },
    });
    assert(resumed.run?.status === 'completed', 'crashed run did not resume to completion');
    assert(resumed.run.writeActionsCount === 1, 'resumed total effect count is incorrect');

    const staleLeaseRun = await startRun('stale-lease');
    let releaseOld!: () => void;
    let oldClaimed!: () => void;
    const oldClaimedPromise = new Promise<void>((resolve) => (oldClaimed = resolve));
    const releaseOldPromise = new Promise<void>((resolve) => (releaseOld = resolve));
    const oldWorker = processDurableProjectAgentRuns({
      runId: staleLeaseRun.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        oldClaimed();
        await releaseOldPromise;
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:fenced',
          expectedPriority: 'high',
          nextPriority: 'critical',
        });
        return completion(1);
      },
    });
    await oldClaimedPromise;
    await sql`update agent_runs set lease_expires_at = now() - interval '1 second' where id = ${staleLeaseRun.run.id}`;
    const recovered = await processDurableProjectAgentRuns({
      runId: staleLeaseRun.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:fenced',
          expectedPriority: 'high',
          nextPriority: 'critical',
        });
        return completion(1);
      },
    });
    releaseOld();
    const staleSummary = await oldWorker;
    assert(recovered.run?.status === 'completed', 'new lease owner did not complete recovered run');
    assert(staleSummary.summary.cancelled === 0, 'lost lease was misclassified as cancellation');

    const policyRun = await startRun('policy-revoked');
    await processDurableProjectAgentRuns({
      runId: policyRun.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        await sql`update system_settings set value = jsonb_set(value, '{globalEnabled}', 'false'::jsonb) where key = 'agent_control_center'`;
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:revoked',
          expectedPriority: 'critical',
          nextPriority: 'low',
        });
        return completion(1);
      },
    });
    const [revokedEffects] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_run_effects where run_id = ${policyRun.run.id}
    `;
    assert(revokedEffects?.total === 0, 'revoked policy committed a domain effect');
    await sql`update system_settings set value = ${JSON.stringify(systemControl)}::jsonb where key = 'agent_control_center'`;

    const staleContextRun = await startRun('stale-context');
    await processDurableProjectAgentRuns({
      runId: staleContextRun.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        await sql`update issues set priority = 'low' where id = ${ids.issue}`;
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'triage:stale-context',
          expectedPriority: 'critical',
          nextPriority: 'medium',
        });
        return completion(1);
      },
    });
    const [staleReceipt] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_run_effects where run_id = ${staleContextRun.run.id}
    `;
    assert(staleReceipt?.total === 0, 'stale-context rollback left an orphan effect receipt');

    await sql`update issues set priority = 'high', sprint_id = ${ids.humanSprint} where id = ${ids.issue}`;
    const staleSprintRun = await startRun('stale-sprint', 'bulk_sprint_creation');
    await processDurableProjectAgentRuns({
      runId: staleSprintRun.run.id,
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 1,
      execute: async (run, lease) => {
        await issueEffect({
          runId: run.id,
          leaseOwner: lease.leaseOwner,
          signal: lease.signal,
          effectKey: 'sprint-assign:stale-context',
          expectedSprintId: null,
          nextSprintId: ids.humanSprint,
          kind: 'bulk_sprint_creation',
        });
        return completion(1);
      },
    });
    const [staleSprintReceipt] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_run_effects where run_id = ${staleSprintRun.run.id}
    `;
    assert(staleSprintReceipt?.total === 0, 'stale sprint CAS left an orphan receipt');

    await sql`update issues set sprint_id = null where id = ${ids.issue}`;
    const bulk = await runProjectAgent({
      projectId: ids.project,
      organizationId: ids.organization,
      projectKey: 'RTE',
      userId: ids.user,
      kind: 'bulk_sprint_creation',
      workspaceSettings,
      projectSettings,
      systemControl,
      idempotencyKey: 'actual-bulk-engine',
    });
    assert(bulk.run.status === 'completed', 'actual bulk engine did not complete');
    assert(bulk.run.writeActionsCount === 2, 'actual bulk engine did not persist both effects');
    const bulkReplay = await runProjectAgent({
      projectId: ids.project,
      organizationId: ids.organization,
      projectKey: 'RTE',
      userId: ids.user,
      kind: 'bulk_sprint_creation',
      workspaceSettings: { ...workspaceSettings, model: 'changed-after-acceptance' },
      projectSettings,
      systemControl,
      idempotencyKey: 'actual-bulk-engine',
    });
    assert(bulkReplay.run.id === bulk.run.id, 'config drift did not replay the original run');
    const [bulkEffects] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_run_effects where run_id = ${bulk.run.id}
    `;
    assert(bulkEffects?.total === 2, 'bulk replay duplicated durable effects');

    const [baseline] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_runs where status in ('pending', 'running')
    `;
    assert(
      (baseline?.total ?? 0) === 0,
      'integration fixture left active runs before admission test'
    );
    const admissions = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        startDurableProjectAgentRun({
          organizationId: ids.organization,
          projectId: ids.project,
          initiatedBy: ids.user,
          kind: 'project_tracking',
          mode: 'manual',
          dryRun: false,
          requestedDryRun: false,
          idempotencyKey: `admission-${index}`,
          input: durableInput('project_tracking'),
          dailyRunLimit: 100,
          maxConcurrentRuns: 2,
        })
          .then(() => true)
          .catch((error) => {
            if (error instanceof ProjectAgentAdmissionError) return false;
            throw error;
          })
      )
    );
    assert(admissions.filter(Boolean).length === 2, 'actual admission store exceeded its limit');

    let resumeRejected = false;
    try {
      await resumeProjectAgentRun({
        runId: policyRun.run.id,
        organizationId: ids.organization,
        projectId: ids.project,
        maxConcurrentRuns: 2,
      });
    } catch (error) {
      resumeRejected =
        error instanceof ProjectAgentAdmissionError && error.code === 'concurrency_limit_reached';
    }
    assert(resumeRejected, 'resume bypassed the global active-run admission limit');

    await processProjectAgentRunQueue({
      organizationId: ids.organization,
      projectId: ids.project,
      limit: 2,
    });
  } finally {
    await sql`delete from system_settings where id = ${ids.systemSetting}`;
    await sql`delete from organizations where id = ${ids.organization}`;
    await sql`delete from users where id = ${ids.user}`;
    await sql.end();
  }
}

main().then(() => console.log('durable project agent runtime integration checks passed'));
