import { createId } from '@paralleldrive/cuid2';
import {
  agentRunEffects,
  agentRuns,
  auditLogs,
  db,
  desc,
  eq,
  issueActivities,
  issues,
  organizations,
  projects,
  sprints,
  systemSettings,
  workflowStatuses,
} from '@tasknebula/db';
import { and, gt, isNull, sql } from 'drizzle-orm';
import { publishEvent } from '@/lib/realtime/events';
import { emitAgentLog, emitAgentStatus } from '@/lib/websocket/server';
import {
  resolveEffectiveProjectAgentSettings,
  normalizeProjectAgentSettings,
  normalizeSystemAgentControlSettings,
  normalizeWorkspaceAgentSettings,
  type AgentRunKind,
  type EffectiveProjectAgentSettings,
  type ProjectAgentSettings,
  type SystemAgentControlSettings,
  type WorkspaceAgentSettings,
} from './config';
import { buildSprintBatchPlan, deriveTriagePriority, getRunKindSummary } from './planner';
import {
  AgentExecutionError,
  serializeAgentProviderPrompt,
  generateAgentPlan,
  normalizeAgentLabels,
  type AgentProviderPlan,
  type SprintPlanProviderPlan,
  type TriageProviderPlan,
  type TrackingProviderPlan,
} from './providers';
import { BudgetExhaustedError, estimatePromptTokens, runWithBudget } from '@/lib/ai/budget';
import type { AgentModelConfigRecord } from './model-configs';
import type { ProjectContext, ProjectIssueRow, ProjectSprintRow } from './types';
import { resolveAgentExecutionPolicy, type AgentWriteDisposition } from './execution-policy';
import {
  createInitialProjectAgentState,
  PROJECT_AGENT_GRAPH_VERSION,
  runProjectAgentGraph,
  type ProjectAgentExecutionResult,
  type ProjectAgentLogEntry,
} from './project-agent-graph';
import {
  ProjectAgentAdmissionError,
  ProjectAgentIdempotencyConflict,
  ProjectAgentLeaseLost,
  getProjectAgentRun,
  loadAgentOrganizationSettings,
  processDurableProjectAgentRuns,
  serializeProjectAgentRunEnvelope,
  startDurableProjectAgentRun,
  type DurableAgentRun,
  type DurableProjectAgentInput,
  type ProjectAgentLeaseContext,
} from './project-agent-run-store';
import { resolveProviderApiKeyFromSettings } from './credentials';
import { getSystemAgentControlSettingsFromDb } from './system';
import { SYSTEM_AGENT_CONTROL_KEY } from './system';

type AgentLogEntry = ProjectAgentLogEntry;
type AgentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RunResponse = {
  run: ReturnType<typeof serializeProjectAgentRunEnvelope>['run'];
  output: Record<string, unknown>;
  dryRun: boolean;
  forcedDryRun: boolean;
  approvalRequired: boolean;
  writeDisposition: AgentWriteDisposition;
  errorCode?: string;
  httpStatus?: number;
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function nextLog(logs: AgentLogEntry[], content: string, type: AgentLogEntry['type'] = 'system') {
  const entry: AgentLogEntry = {
    logIndex: logs.length,
    type,
    content,
    timestamp: new Date().toISOString(),
  };

  logs.push(entry);
  return entry;
}

async function assertActiveEffectLease(
  tx: AgentTransaction,
  params: {
    runId: string;
    organizationId: string;
    projectId: string;
    leaseOwner: string;
    signal: AbortSignal;
    kind: AgentRunKind;
  }
) {
  params.signal.throwIfAborted();
  const [owned] = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, params.runId),
        eq(agentRuns.organizationId, params.organizationId),
        eq(agentRuns.projectId, params.projectId),
        eq(agentRuns.graphVersion, PROJECT_AGENT_GRAPH_VERSION),
        eq(agentRuns.status, 'running'),
        eq(agentRuns.leaseOwner, params.leaseOwner),
        gt(agentRuns.leaseExpiresAt, new Date()),
        isNull(agentRuns.cancelRequestedAt)
      )
    )
    .limit(1)
    .for('update');
  params.signal.throwIfAborted();
  if (!owned) throw new ProjectAgentLeaseLost();

  const [[organization], [project], [systemSetting]] = await Promise.all([
    tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, params.organizationId))
      .limit(1),
    tx
      .select({ settings: projects.settings })
      .from(projects)
      .where(
        and(eq(projects.id, params.projectId), eq(projects.organizationId, params.organizationId))
      )
      .limit(1),
    tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, SYSTEM_AGENT_CONTROL_KEY))
      .limit(1),
  ]);
  if (!organization || !project)
    throw new AgentExecutionError('Agent policy context is missing.', 'policy_revoked', 409);
  const workspace = normalizeWorkspaceAgentSettings(
    (organization.settings as Record<string, unknown> | null)?.aiAgents
  );
  const projectPolicy = normalizeProjectAgentSettings(
    (project.settings as Record<string, unknown> | null)?.aiAgents
  );
  const system = normalizeSystemAgentControlSettings(systemSetting?.value);
  const effective = resolveEffectiveProjectAgentSettings(workspace, projectPolicy, system);
  const writePolicy = resolveAgentExecutionPolicy({
    kind: params.kind,
    requestedDryRun: false,
    allowWriteActions: effective.allowWriteActions,
    requireApprovalForWrites: effective.requireApprovalForWrites,
    aiOversight: effective.aiOversight,
  });
  if (
    !system.globalEnabled ||
    !workspace.enabled ||
    !projectPolicy.enabled ||
    !effective.capabilities[params.kind] ||
    writePolicy.dryRun
  ) {
    throw new AgentExecutionError(
      'Project agent write policy was revoked before the effect committed.',
      'policy_revoked',
      409
    );
  }
}

export type ProjectAgentIssueEffectInput = {
  runId: string;
  organizationId: string;
  projectId: string;
  issueId: string;
  userId: string;
  leaseOwner: string;
  signal: AbortSignal;
  kind: Extract<AgentRunKind, 'backlog_triage' | 'bulk_sprint_creation'>;
  effectKey: string;
  effectType: 'issue_triage' | 'sprint_assign_issue';
  effectPayload: Record<string, unknown>;
  expected: {
    priority?: ProjectIssueRow['priority'];
    labels?: unknown;
    sprintId?: string | null;
  };
  set: {
    priority?: ProjectIssueRow['priority'];
    labels?: string[];
    sprintId?: string | null;
  };
  activity: {
    type: 'updated';
    field: 'priority' | 'sprintId';
    oldValue: string | null;
    newValue: string | null;
    metadata: Record<string, unknown>;
  };
  audit: {
    action: 'issue.priority_changed' | 'sprint.issue_added';
    resourceType: 'issue' | 'sprint';
    resourceId: string;
    changes: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
  staleMessage: string;
};

/**
 * Apply one issue effect with the durable receipt, lease/policy fence, stale
 * context CAS, activity and audit in the same database transaction.
 */
export async function applyProjectAgentIssueEffect(params: ProjectAgentIssueEffectInput) {
  return db.transaction(async (tx) => {
    await assertActiveEffectLease(tx, params);
    const [receipt] = await tx
      .insert(agentRunEffects)
      .values({
        id: createId(),
        organizationId: params.organizationId,
        projectId: params.projectId,
        runId: params.runId,
        effectKey: params.effectKey,
        effectType: params.effectType,
        payload: params.effectPayload,
      })
      .onConflictDoNothing({
        target: [agentRunEffects.runId, agentRunEffects.effectKey],
      })
      .returning({ id: agentRunEffects.id });
    if (!receipt) return false;

    const predicates = [
      eq(issues.id, params.issueId),
      eq(issues.projectId, params.projectId),
      eq(issues.organizationId, params.organizationId),
    ];
    if (params.expected.priority !== undefined) {
      predicates.push(eq(issues.priority, params.expected.priority));
    }
    if ('labels' in params.expected) {
      predicates.push(sql`${issues.labels} = ${JSON.stringify(params.expected.labels)}::jsonb`);
    }
    if ('sprintId' in params.expected) {
      predicates.push(
        params.expected.sprintId === null
          ? isNull(issues.sprintId)
          : eq(issues.sprintId, params.expected.sprintId!)
      );
    }

    const [updatedIssue] = await tx
      .update(issues)
      .set({ ...params.set, updatedAt: new Date(), updatedBy: params.userId })
      .where(and(...predicates))
      .returning({ id: issues.id });
    if (!updatedIssue) throw new Error(params.staleMessage);

    await tx.insert(issueActivities).values({
      id: createId(),
      issueId: params.issueId,
      userId: params.userId,
      type: params.activity.type,
      field: params.activity.field,
      oldValue: params.activity.oldValue,
      newValue: params.activity.newValue,
      metadata: params.activity.metadata,
      createdBy: params.userId,
      updatedBy: params.userId,
    });
    await tx.insert(auditLogs).values({
      id: createId(),
      userId: params.userId,
      organizationId: params.organizationId,
      action: params.audit.action,
      resourceType: params.audit.resourceType,
      resourceId: params.audit.resourceId,
      projectId: params.projectId,
      issueId: params.issueId,
      changes: params.audit.changes,
      metadata: params.audit.metadata,
    });
    return true;
  });
}

async function loadProjectContext(
  projectId: string,
  organizationId?: string
): Promise<ProjectContext | null> {
  const [project] = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      name: projects.name,
      key: projects.key,
    })
    .from(projects)
    .where(
      organizationId
        ? and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))
        : eq(projects.id, projectId)
    )
    .limit(1);

  if (!project) {
    return null;
  }

  const [projectIssues, projectSprints] = await Promise.all([
    db
      .select({
        id: issues.id,
        key: issues.key,
        title: issues.title,
        type: issues.type,
        priority: issues.priority,
        labels: issues.labels,
        dueDate: issues.dueDate,
        sprintId: issues.sprintId,
        assigneeId: issues.assigneeId,
        statusCategory: workflowStatuses.category,
        statusName: workflowStatuses.name,
      })
      .from(issues)
      .leftJoin(workflowStatuses, eq(issues.statusId, workflowStatuses.id))
      .where(
        organizationId
          ? and(eq(issues.projectId, projectId), eq(issues.organizationId, organizationId))
          : eq(issues.projectId, projectId)
      ),
    db
      .select({
        id: sprints.id,
        name: sprints.name,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        status: sprints.status,
      })
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(desc(sprints.startDate)),
  ]);

  return {
    project,
    issues: projectIssues,
    sprints: projectSprints,
  };
}

type ProjectTrackingMetrics = {
  activeSprint: ProjectSprintRow | null;
  totalIssues: number;
  openIssues: number;
  overdueIssues: number;
  unassignedIssues: number;
  blockedIssues: number;
  backlogIssues: number;
};

type TriageProposal = {
  issue: ProjectIssueRow;
  targetPriority: ProjectIssueRow['priority'];
  nextLabels: string[];
  changed: boolean;
  rationale?: string;
};

type PlannedSprintRecord = {
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  issueKeys: string[];
};

function emitLog(runId: string, projectId: string, entry: AgentLogEntry) {
  emitAgentLog(runId, projectId, {
    logIndex: entry.logIndex,
    type: entry.type,
    content: entry.content,
    timestamp: new Date(entry.timestamp),
  });
}

function collectProjectTrackingMetrics(context: ProjectContext): ProjectTrackingMetrics {
  const activeSprint = context.sprints.find((sprint) => sprint.status === 'active') ?? null;
  const issuesInProject = context.issues;
  const openIssues = issuesInProject.filter((issue) => issue.statusCategory !== 'done');
  const overdueIssues = openIssues.filter(
    (issue) => issue.dueDate && issue.dueDate.getTime() < Date.now()
  );
  const unassignedIssues = openIssues.filter((issue) => !issue.assigneeId);
  const blockedIssues = openIssues.filter(
    (issue) =>
      issue.statusCategory === 'blocked' ||
      asStringArray(issue.labels).some((label) => label.toLowerCase() === 'blocked')
  );
  const backlogIssues = openIssues.filter((issue) => !issue.sprintId);

  return {
    activeSprint,
    totalIssues: issuesInProject.length,
    openIssues: openIssues.length,
    overdueIssues: overdueIssues.length,
    unassignedIssues: unassignedIssues.length,
    blockedIssues: blockedIssues.length,
    backlogIssues: backlogIssues.length,
  };
}

function createNativeTrackingRecommendations(metrics: ProjectTrackingMetrics) {
  const recommendations: string[] = [];

  if (metrics.overdueIssues > 0) {
    recommendations.push(
      `${metrics.overdueIssues} issue is overdue and needs a decision on scope or ownership.`
    );
  }
  if (metrics.blockedIssues > 0) {
    recommendations.push(
      `${metrics.blockedIssues} issue is blocked. Review blockers before the next planning cycle.`
    );
  }
  if (!metrics.activeSprint && metrics.backlogIssues >= 5) {
    recommendations.push('Backlog volume is high enough to draft the next sprint plan.');
  }
  if (metrics.unassignedIssues > 0) {
    recommendations.push(`${metrics.unassignedIssues} open issue is unassigned.`);
  }

  return recommendations;
}

function buildBacklogTriageProposals(context: ProjectContext, generatedPlan?: TriageProviderPlan) {
  const backlogIssues = context.issues.filter(
    (issue) => !issue.sprintId && issue.statusCategory !== 'done'
  );

  if (!generatedPlan) {
    return backlogIssues
      .map<TriageProposal>((issue) => {
        const labels = asStringArray(issue.labels);
        const targetPriority = deriveTriagePriority({
          id: issue.id,
          key: issue.key,
          title: issue.title,
          type: issue.type,
          priority: issue.priority,
          labels,
          dueDate: issue.dueDate,
        });
        const nextLabels = normalizeAgentLabels(
          labels.includes('agent-triaged') ? labels : [...labels, 'agent-triaged']
        );

        return {
          issue,
          targetPriority,
          nextLabels,
          changed:
            targetPriority !== issue.priority ||
            JSON.stringify(nextLabels) !== JSON.stringify(labels),
        };
      })
      .filter((proposal) => proposal.changed);
  }

  const issueByKey = new Map(backlogIssues.map((issue) => [issue.key, issue]));
  const seenKeys = new Set<string>();
  const proposals: TriageProposal[] = [];

  for (const change of generatedPlan.changedIssues) {
    if (seenKeys.has(change.issueKey)) {
      continue;
    }

    const issue = issueByKey.get(change.issueKey);
    if (!issue) {
      continue;
    }

    const currentLabels = asStringArray(issue.labels);
    const nextLabels = normalizeAgentLabels([
      ...currentLabels,
      ...change.addLabels,
      'agent-triaged',
    ]);

    proposals.push({
      issue,
      targetPriority: change.nextPriority,
      nextLabels,
      changed:
        change.nextPriority !== issue.priority ||
        JSON.stringify(nextLabels) !== JSON.stringify(currentLabels),
      rationale: change.rationale,
    });

    seenKeys.add(change.issueKey);
  }

  if (generatedPlan.changedIssues.length > 0 && proposals.length === 0) {
    throw new AgentExecutionError(
      'The LLM returned backlog changes, but none matched the current project backlog.',
      'provider_invalid_output',
      502
    );
  }

  return proposals.filter((proposal) => proposal.changed);
}

function materializePlannedSprints(params: {
  context: ProjectContext;
  effectiveSettings: EffectiveProjectAgentSettings;
  generatedPlan?: SprintPlanProviderPlan;
}) {
  if (!params.generatedPlan) {
    return buildSprintBatchPlan({
      issues: params.context.issues
        .filter((issue) => !issue.sprintId && issue.statusCategory !== 'done')
        .map((issue) => ({
          id: issue.id,
          key: issue.key,
          title: issue.title,
          type: issue.type,
          priority: issue.priority,
          labels: asStringArray(issue.labels),
          dueDate: issue.dueDate,
        })),
      sprintBatchSize: params.effectiveSettings.sprintBatchSize,
      sprintLengthDays: params.effectiveSettings.sprintLengthDays,
      issueCapacityPerSprint: params.effectiveSettings.issueCapacityPerSprint,
      startDate: resolveSprintStartDate(params.context.sprints),
      existingSprintCount: params.context.sprints.length,
    }).map((sprint) => ({
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
      issueKeys: sprint.issues.map((issue) => issue.key),
    })) satisfies PlannedSprintRecord[];
  }

  const backlogIssueMap = new Map(
    params.context.issues
      .filter((issue) => !issue.sprintId && issue.statusCategory !== 'done')
      .map((issue) => [issue.key, issue])
  );
  const seenIssueKeys = new Set<string>();
  const plannedSprints: PlannedSprintRecord[] = [];
  const startDate = resolveSprintStartDate(params.context.sprints);

  for (const [index, sprint] of params.generatedPlan.plannedSprints
    .slice(0, params.effectiveSettings.sprintBatchSize)
    .entries()) {
    const issueKeys = sprint.issueKeys
      .filter((issueKey) => {
        if (seenIssueKeys.has(issueKey) || !backlogIssueMap.has(issueKey)) {
          return false;
        }

        seenIssueKeys.add(issueKey);
        return true;
      })
      .slice(0, params.effectiveSettings.issueCapacityPerSprint);

    if (issueKeys.length === 0) {
      continue;
    }

    const sprintStart = new Date(startDate);
    sprintStart.setDate(sprintStart.getDate() + index * params.effectiveSettings.sprintLengthDays);

    const sprintEnd = new Date(sprintStart);
    sprintEnd.setDate(sprintEnd.getDate() + params.effectiveSettings.sprintLengthDays - 1);

    plannedSprints.push({
      name:
        sprint.name.trim() || `Sprint ${params.context.sprints.length + plannedSprints.length + 1}`,
      goal: sprint.goal.trim() || `Deliver ${issueKeys.slice(0, 3).join(', ')}.`,
      startDate: sprintStart.toISOString(),
      endDate: sprintEnd.toISOString(),
      issueKeys,
    });
  }

  if (params.generatedPlan.plannedSprints.length > 0 && plannedSprints.length === 0) {
    throw new AgentExecutionError(
      'The LLM returned sprint batches, but none mapped to backlog issues in this project.',
      'provider_invalid_output',
      502
    );
  }

  return plannedSprints;
}

async function runProjectTracking(params: {
  context: ProjectContext;
  logs: AgentLogEntry[];
  generatedPlan?: TrackingProviderPlan;
}) {
  const metrics = collectProjectTrackingMetrics(params.context);

  nextLog(
    params.logs,
    `Scanned ${metrics.totalIssues} issues across ${params.context.project.name}.`
  );
  nextLog(
    params.logs,
    metrics.activeSprint
      ? `Active sprint detected: ${metrics.activeSprint.name}.`
      : 'No active sprint is running in this project.'
  );

  const recommendations = params.generatedPlan?.recommendations?.length
    ? params.generatedPlan.recommendations
    : createNativeTrackingRecommendations(metrics);

  const summary =
    params.generatedPlan?.summary ||
    (metrics.activeSprint
      ? `${params.context.project.name} has ${metrics.openIssues} open issues and ${metrics.blockedIssues} blockers in flight.`
      : `${params.context.project.name} has ${metrics.openIssues} open issues with no active sprint.`);

  return {
    summary,
    writeActionsCount: 0,
    output: {
      activeSprint: metrics.activeSprint,
      metrics: {
        totalIssues: metrics.totalIssues,
        openIssues: metrics.openIssues,
        overdueIssues: metrics.overdueIssues,
        unassignedIssues: metrics.unassignedIssues,
        blockedIssues: metrics.blockedIssues,
        backlogIssues: metrics.backlogIssues,
      },
      recommendations,
      highlights: params.generatedPlan?.highlights ?? [],
    },
  };
}

async function runBacklogTriage(params: {
  runId: string;
  userId: string;
  context: ProjectContext;
  effectiveSettings: EffectiveProjectAgentSettings;
  dryRun: boolean;
  logs: AgentLogEntry[];
  generatedPlan?: TriageProviderPlan;
  leaseOwner: string;
  signal: AbortSignal;
}) {
  const backlogIssues = params.context.issues.filter(
    (issue) => !issue.sprintId && issue.statusCategory !== 'done'
  );

  nextLog(params.logs, `Found ${backlogIssues.length} backlog issues to inspect.`);

  const proposals = buildBacklogTriageProposals(params.context, params.generatedPlan);

  if (proposals.length === 0) {
    nextLog(params.logs, 'Backlog already matches the current triage heuristics.');
    return {
      summary: params.generatedPlan?.summary || 'Backlog triage found no changes to apply.',
      writeActionsCount: 0,
      output: {
        changedIssues: [],
      },
    };
  }

  nextLog(params.logs, `${proposals.length} issue will be re-ranked by the triage engine.`);

  if (params.dryRun || !params.effectiveSettings.allowWriteActions) {
    nextLog(params.logs, 'Write actions are disabled, returning a preview only.');
    return {
      summary:
        params.generatedPlan?.summary || `Prepared ${proposals.length} backlog triage updates.`,
      writeActionsCount: 0,
      output: {
        changedIssues: proposals.map((proposal) => ({
          issueId: proposal.issue.id,
          key: proposal.issue.key,
          title: proposal.issue.title,
          previousPriority: proposal.issue.priority,
          nextPriority: proposal.targetPriority,
          nextLabels: proposal.nextLabels,
          rationale: proposal.rationale ?? null,
        })),
      },
    };
  }

  let writeActionsCount = 0;
  for (const proposal of proposals) {
    params.signal.throwIfAborted();
    const applied = await applyProjectAgentIssueEffect({
      runId: params.runId,
      organizationId: params.context.project.organizationId,
      projectId: params.context.project.id,
      issueId: proposal.issue.id,
      userId: params.userId,
      leaseOwner: params.leaseOwner,
      signal: params.signal,
      kind: 'backlog_triage',
      effectKey: `triage:${proposal.issue.id}`,
      effectType: 'issue_triage',
      effectPayload: {
        issueId: proposal.issue.id,
        priority: proposal.targetPriority,
        labels: proposal.nextLabels,
      },
      expected: { priority: proposal.issue.priority, labels: proposal.issue.labels },
      set: { priority: proposal.targetPriority, labels: proposal.nextLabels },
      activity: {
        type: 'updated',
        field: 'priority',
        oldValue: proposal.issue.priority,
        newValue: proposal.targetPriority,
        metadata: { source: 'agent', runId: params.runId, labels: proposal.nextLabels },
      },
      audit: {
        action: 'issue.priority_changed',
        resourceType: 'issue',
        resourceId: proposal.issue.id,
        changes: {
          priority: { from: proposal.issue.priority, to: proposal.targetPriority },
          labels: { from: proposal.issue.labels, to: proposal.nextLabels },
        },
        metadata: { source: 'agent', runId: params.runId },
      },
      staleMessage: 'Triage target no longer belongs to this project or changed after planning.',
    });

    // The database mutation is exactly-once for this run. Realtime delivery
    // remains best-effort and is emitted only by the transaction winner.
    if (applied) {
      publishEvent('issue.updated', params.userId, {
        projectId: params.context.project.id,
        issueId: proposal.issue.id,
        organizationId: params.context.project.organizationId,
      });
    }
    writeActionsCount += 1;
  }

  nextLog(params.logs, `Applied ${writeActionsCount} triage updates to backlog issues.`);

  return {
    summary:
      params.generatedPlan?.summary ||
      `Updated ${writeActionsCount} backlog issues with fresh priority and labels.`,
    writeActionsCount,
    output: {
      changedIssues: proposals.map((proposal) => ({
        issueId: proposal.issue.id,
        key: proposal.issue.key,
        title: proposal.issue.title,
        previousPriority: proposal.issue.priority,
        nextPriority: proposal.targetPriority,
        rationale: proposal.rationale ?? null,
      })),
    },
  };
}

function resolveSprintStartDate(projectSprints: ProjectSprintRow[]) {
  const latestSprint = [...projectSprints].sort(
    (left, right) => right.endDate.getTime() - left.endDate.getTime()
  )[0];
  const startDate = latestSprint ? new Date(latestSprint.endDate) : new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() + 1);
  return startDate;
}

async function buildSprintPlanningOutput(params: {
  context: ProjectContext;
  effectiveSettings: EffectiveProjectAgentSettings;
  logs: AgentLogEntry[];
  generatedPlan?: SprintPlanProviderPlan;
}) {
  const backlogIssues = params.context.issues.filter(
    (issue) => !issue.sprintId && issue.statusCategory !== 'done'
  );

  nextLog(params.logs, `Planning against ${backlogIssues.length} backlog issues.`);

  const plan = materializePlannedSprints({
    context: params.context,
    effectiveSettings: params.effectiveSettings,
    generatedPlan: params.generatedPlan,
  });

  return {
    summary:
      params.generatedPlan?.summary ||
      (plan.length > 0
        ? `Prepared ${plan.length} sprint plan block${plan.length === 1 ? '' : 's'} for ${params.context.project.name}.`
        : 'No eligible backlog issues were found for sprint planning.'),
    output: {
      plannedSprints: plan.map((sprint) => ({
        name: sprint.name,
        goal: sprint.goal,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        issueKeys: sprint.issueKeys,
      })),
    },
  };
}

async function runBulkSprintCreation(params: {
  runId: string;
  userId: string;
  context: ProjectContext;
  effectiveSettings: EffectiveProjectAgentSettings;
  dryRun: boolean;
  logs: AgentLogEntry[];
  generatedPlan?: SprintPlanProviderPlan;
  leaseOwner: string;
  signal: AbortSignal;
}) {
  const planning = await buildSprintPlanningOutput({
    context: params.context,
    effectiveSettings: params.effectiveSettings,
    logs: params.logs,
    generatedPlan: params.generatedPlan,
  });

  const plannedSprints = (planning.output.plannedSprints ?? []) as Array<{
    name: string;
    goal: string;
    startDate: string;
    endDate: string;
    issueKeys: string[];
  }>;

  if (plannedSprints.length === 0) {
    return {
      summary: planning.summary,
      writeActionsCount: 0,
      output: planning.output,
    };
  }

  if (params.dryRun || !params.effectiveSettings.allowWriteActions) {
    nextLog(params.logs, 'Bulk sprint creation is in preview mode only.');
    return {
      summary: planning.summary,
      writeActionsCount: 0,
      output: planning.output,
    };
  }

  const issueByKey = new Map(params.context.issues.map((issue) => [issue.key, issue]));
  let writeActionsCount = 0;
  const createdSprints: Array<Record<string, unknown>> = [];

  for (const [sprintIndex, plannedSprint] of plannedSprints.entries()) {
    params.signal.throwIfAborted();
    const sprintEffect = await db.transaction(async (tx) => {
      await assertActiveEffectLease(tx, {
        runId: params.runId,
        organizationId: params.context.project.organizationId,
        projectId: params.context.project.id,
        leaseOwner: params.leaseOwner,
        signal: params.signal,
        kind: 'bulk_sprint_creation',
      });
      const sprintId = createId();
      const effectKey = `sprint:${sprintIndex}`;
      const [receipt] = await tx
        .insert(agentRunEffects)
        .values({
          id: createId(),
          organizationId: params.context.project.organizationId,
          projectId: params.context.project.id,
          runId: params.runId,
          effectKey,
          effectType: 'sprint_create',
          payload: { sprintId, plannedSprint },
        })
        .onConflictDoNothing({
          target: [agentRunEffects.runId, agentRunEffects.effectKey],
        })
        .returning({ payload: agentRunEffects.payload });

      if (!receipt) {
        const [existing] = await tx
          .select({ payload: agentRunEffects.payload })
          .from(agentRunEffects)
          .where(
            and(
              eq(agentRunEffects.runId, params.runId),
              eq(agentRunEffects.effectKey, effectKey),
              eq(agentRunEffects.organizationId, params.context.project.organizationId)
            )
          )
          .limit(1);
        const payload = existing?.payload as { sprintId?: unknown } | undefined;
        if (typeof payload?.sprintId !== 'string') {
          throw new Error('Persisted sprint effect is invalid.');
        }
        return { applied: false, sprintId: payload.sprintId };
      }

      const [createdSprint] = await tx
        .insert(sprints)
        .values({
          id: sprintId,
          projectId: params.context.project.id,
          name: plannedSprint.name,
          goal: plannedSprint.goal,
          startDate: new Date(plannedSprint.startDate),
          endDate: new Date(plannedSprint.endDate),
          status: 'planned',
          createdBy: params.userId,
          updatedBy: params.userId,
        })
        .returning();
      if (!createdSprint) throw new Error('Failed to create sprint');

      await tx.insert(auditLogs).values({
        id: createId(),
        userId: params.userId,
        organizationId: params.context.project.organizationId,
        action: 'sprint.created',
        resourceType: 'sprint',
        resourceId: createdSprint.id,
        projectId: params.context.project.id,
        changes: {
          name: { from: null, to: createdSprint.name },
          status: { from: null, to: createdSprint.status },
        },
        metadata: { source: 'agent', runId: params.runId },
      });
      return { applied: true, sprintId: createdSprint.id };
    });

    createdSprints.push({
      id: sprintEffect.sprintId,
      name: plannedSprint.name,
      issueKeys: plannedSprint.issueKeys,
    });

    if (sprintEffect.applied) {
      publishEvent('sprint.created', params.userId, {
        projectId: params.context.project.id,
        sprintId: sprintEffect.sprintId,
        organizationId: params.context.project.organizationId,
      });
    }
    writeActionsCount += 1;

    if (params.effectiveSettings.autoAssignToPlannedSprints) {
      for (const issueKey of plannedSprint.issueKeys) {
        params.signal.throwIfAborted();
        const issue = issueByKey.get(issueKey);
        if (!issue) {
          continue;
        }

        const assignmentApplied = await applyProjectAgentIssueEffect({
          runId: params.runId,
          organizationId: params.context.project.organizationId,
          projectId: params.context.project.id,
          issueId: issue.id,
          userId: params.userId,
          leaseOwner: params.leaseOwner,
          signal: params.signal,
          kind: 'bulk_sprint_creation',
          effectKey: `sprint-assign:${sprintIndex}:${issue.id}`,
          effectType: 'sprint_assign_issue',
          effectPayload: { sprintId: sprintEffect.sprintId, issueId: issue.id },
          expected: { sprintId: issue.sprintId },
          set: { sprintId: sprintEffect.sprintId },
          activity: {
            type: 'updated',
            field: 'sprintId',
            oldValue: issue.sprintId,
            newValue: sprintEffect.sprintId,
            metadata: {
              source: 'agent',
              runId: params.runId,
              sprintName: plannedSprint.name,
            },
          },
          audit: {
            action: 'sprint.issue_added',
            resourceType: 'sprint',
            resourceId: sprintEffect.sprintId,
            changes: { sprintId: { from: issue.sprintId, to: sprintEffect.sprintId } },
            metadata: { source: 'agent', runId: params.runId, issueKey: issue.key },
          },
          staleMessage:
            'Sprint assignment target no longer belongs to this project or changed after planning.',
        });

        if (assignmentApplied) {
          publishEvent('sprint.issues.changed', params.userId, {
            projectId: params.context.project.id,
            sprintId: sprintEffect.sprintId,
            issueId: issue.id,
            organizationId: params.context.project.organizationId,
          });
        }
        writeActionsCount += 1;
      }
    }
  }

  nextLog(
    params.logs,
    `Created ${createdSprints.length} planned sprint${createdSprints.length === 1 ? '' : 's'} from backlog.`
  );

  return {
    summary: `Created ${createdSprints.length} planned sprints for ${params.context.project.name}.`,
    writeActionsCount,
    output: {
      createdSprints,
    },
  };
}

export async function listProjectAgentRuns(projectId: string, limit = 12) {
  const rows = await db
    .select({
      id: agentRuns.id,
      kind: agentRuns.kind,
      status: agentRuns.status,
      dryRun: agentRuns.dryRun,
      summary: agentRuns.summary,
      writeActionsCount: agentRuns.writeActionsCount,
      createdAt: agentRuns.createdAt,
      completedAt: agentRuns.completedAt,
      mode: agentRuns.mode,
      output: agentRuns.output,
    })
    .from(agentRuns)
    .where(eq(agentRuns.projectId, projectId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  return rows.map((run) => {
    const output = (run.output ?? {}) as Record<string, unknown>;
    const { error: _internalError, ...safeOutput } = output;
    return {
      ...run,
      output: safeOutput,
      errorCode: typeof output.errorCode === 'string' ? output.errorCode : null,
    };
  });
}

function durableRunInput(run: DurableAgentRun): DurableProjectAgentInput {
  const input = run.input as Partial<DurableProjectAgentInput>;
  if (
    input.kind !== run.kind ||
    !input.effectiveSettings ||
    typeof input.projectKey !== 'string' ||
    typeof input.forcedDryRun !== 'boolean' ||
    typeof input.approvalRequired !== 'boolean' ||
    !input.writeDisposition
  ) {
    throw new Error('Project agent run input is invalid.');
  }
  return input as DurableProjectAgentInput;
}

function unwrapAgentError(error: unknown): unknown {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && current.cause && !seen.has(current.cause)) {
    seen.add(current);
    current = current.cause;
  }
  return current;
}

function classifyAgentError(error: unknown) {
  const cause = unwrapAgentError(error);
  if (cause instanceof BudgetExhaustedError) {
    return { errorCode: `budget_${cause.code}`, httpStatus: 429 };
  }
  if (cause instanceof AgentExecutionError) {
    return { errorCode: cause.code, httpStatus: cause.statusCode };
  }
  return { errorCode: 'agent_run_failed', httpStatus: 500 };
}

async function executeProjectAgentKind(params: {
  run: DurableAgentRun;
  input: DurableProjectAgentInput;
  context: ProjectContext;
  generatedPlan: AgentProviderPlan | null;
  logs: AgentLogEntry[];
  leaseOwner: string;
  signal: AbortSignal;
}): Promise<ProjectAgentExecutionResult> {
  const generatedPlan = params.generatedPlan ?? undefined;
  switch (params.run.kind) {
    case 'project_tracking':
      return runProjectTracking({
        context: params.context,
        logs: params.logs,
        generatedPlan: generatedPlan?.kind === 'project_tracking' ? generatedPlan : undefined,
      });
    case 'backlog_triage':
      return runBacklogTriage({
        runId: params.run.id,
        userId: params.run.initiatedBy,
        context: params.context,
        effectiveSettings: params.input.effectiveSettings,
        dryRun: params.run.dryRun,
        logs: params.logs,
        generatedPlan: generatedPlan?.kind === 'backlog_triage' ? generatedPlan : undefined,
        leaseOwner: params.leaseOwner,
        signal: params.signal,
      });
    case 'sprint_planning':
      return buildSprintPlanningOutput({
        context: params.context,
        effectiveSettings: params.input.effectiveSettings,
        logs: params.logs,
        generatedPlan:
          generatedPlan?.kind === 'sprint_planning' ||
          generatedPlan?.kind === 'bulk_sprint_creation'
            ? generatedPlan
            : undefined,
      });
    case 'bulk_sprint_creation':
      return runBulkSprintCreation({
        runId: params.run.id,
        userId: params.run.initiatedBy,
        context: params.context,
        effectiveSettings: params.input.effectiveSettings,
        dryRun: params.run.dryRun,
        logs: params.logs,
        generatedPlan:
          generatedPlan?.kind === 'sprint_planning' ||
          generatedPlan?.kind === 'bulk_sprint_creation'
            ? generatedPlan
            : undefined,
        leaseOwner: params.leaseOwner,
        signal: params.signal,
      });
  }
}

async function executeClaimedProjectAgentRun(
  run: DurableAgentRun,
  lease: ProjectAgentLeaseContext,
  providerApiKeyOverride?: string | null
) {
  const input = durableRunInput(run);
  const organizationSettings = await loadAgentOrganizationSettings(run.organizationId);
  const systemControl = await getSystemAgentControlSettingsFromDb();
  const [currentProject] = await db
    .select({ settings: projects.settings })
    .from(projects)
    .where(and(eq(projects.id, run.projectId!), eq(projects.organizationId, run.organizationId)))
    .limit(1);
  const currentWorkspacePolicy = normalizeWorkspaceAgentSettings(
    (organizationSettings as Record<string, unknown> | null)?.aiAgents
  );
  const currentProjectPolicy = normalizeProjectAgentSettings(
    (currentProject?.settings as Record<string, unknown> | null)?.aiAgents
  );
  const currentEffectivePolicy = resolveEffectiveProjectAgentSettings(
    currentWorkspacePolicy,
    currentProjectPolicy,
    systemControl
  );
  const currentWritePolicy = resolveAgentExecutionPolicy({
    kind: run.kind,
    requestedDryRun: run.dryRun,
    allowWriteActions: currentEffectivePolicy.allowWriteActions,
    requireApprovalForWrites: currentEffectivePolicy.requireApprovalForWrites,
    aiOversight: currentEffectivePolicy.aiOversight,
  });
  if (
    !currentProject ||
    !systemControl.globalEnabled ||
    !currentWorkspacePolicy.enabled ||
    !currentProjectPolicy.enabled ||
    !currentEffectivePolicy.capabilities[run.kind] ||
    (!run.dryRun && currentWritePolicy.dryRun)
  ) {
    throw new AgentExecutionError(
      'Project agent policy was revoked before the run resumed.',
      'policy_revoked',
      409
    );
  }
  const providerApiKey =
    providerApiKeyOverride ??
    resolveProviderApiKeyFromSettings(
      organizationSettings,
      input.effectiveSettings.provider,
      systemControl.providerCredentials
    );

  const graphResult = await runProjectAgentGraph(
    {
      loadContext: async () => {
        const context = await loadProjectContext(run.projectId!, run.organizationId);
        if (!context) throw new Error('Project not found');
        const logs: AgentLogEntry[] = [];
        const openingLog = nextLog(
          logs,
          `${getRunKindSummary(run.kind)} started for ${context.project.name}${run.dryRun ? ' in preview mode' : ''}.`
        );
        emitAgentStatus(run.id, context.project.id, { status: 'running', progress: 5 });
        emitLog(run.id, context.project.id, openingLog);
        return { context, logs };
      },
      plan: async ({ context, logs, signal }) => {
        const providerLog = nextLog(
          logs,
          input.modelConfig
            ? `Using ${input.effectiveSettings.provider} provider with model ${input.effectiveSettings.model || 'n/a'} via profile ${input.modelConfig.name}.`
            : `Using ${input.effectiveSettings.provider} provider with model ${input.effectiveSettings.model || 'n/a'}.`
        );
        emitLog(run.id, context.project.id, providerLog);
        emitAgentStatus(run.id, context.project.id, { status: 'running', progress: 18 });

        if (input.effectiveSettings.provider === 'native') return { plan: null, logs };
        const plannerLog = nextLog(
          logs,
          'Requesting a structured agent plan from the configured LLM provider.'
        );
        emitLog(run.id, context.project.id, plannerLog);
        const providerPrompt = serializeAgentProviderPrompt({
          kind: run.kind,
          context,
          effectiveSettings: input.effectiveSettings,
        });
        const plan = await runWithBudget(
          {
            organizationId: run.organizationId,
            userId: run.initiatedBy,
            provider: input.effectiveSettings.provider,
            model: input.effectiveSettings.model || 'unknown',
            feature: `agent_run:${run.kind}`,
            prompt: providerPrompt,
            estimatedTokens:
              estimatePromptTokens(providerPrompt) +
              (input.modelConfig?.settings.maxOutputTokens || 4096),
          },
          async () => {
            const generated = await generateAgentPlan({
              kind: run.kind,
              model: input.effectiveSettings.model,
              effectiveSettings: input.effectiveSettings,
              context,
              apiKey: providerApiKey,
              modelConfigId: input.modelConfig?.id ?? null,
              modelConfigName: input.modelConfig?.name ?? null,
              modelTuning: input.modelConfig?.settings ?? null,
              userId: run.initiatedBy,
              signal,
              // Three transient attempts plus bounded backoff fit comfortably
              // inside the graph's 120s active-runtime budget.
              providerTimeoutMs: 30_000,
            });
            return {
              value: generated,
              usage: {
                inputTokens: estimatePromptTokens(providerPrompt),
                outputTokens: estimatePromptTokens(JSON.stringify(generated)),
              },
            };
          }
        );
        const generatedLog = nextLog(logs, 'Structured provider plan generated successfully.');
        emitLog(run.id, context.project.id, generatedLog);
        emitAgentStatus(run.id, context.project.id, { status: 'running', progress: 42 });
        return { plan, logs };
      },
      execute: async ({ context, plan, logs, signal }) => {
        const result = await executeProjectAgentKind({
          run,
          input,
          context,
          generatedPlan: plan,
          logs,
          leaseOwner: lease.leaseOwner,
          signal,
        });
        const closingLog = nextLog(logs, result.summary);
        emitLog(run.id, context.project.id, closingLog);
        return { result, logs };
      },
    },
    lease.checkpoint?.state ?? createInitialProjectAgentState(run.kind),
    {
      checkpoint: lease.checkpoint,
      signal: lease.signal,
      maxSteps: run.maxSteps,
      maxVisitsPerNode: run.maxVisitsPerNode,
      maxRuntimeMs: lease.remainingRuntimeMs,
      maxConsecutiveNoProgress: run.maxConsecutiveNoProgress,
      onCheckpoint: lease.persistCheckpoint,
      onEvent: lease.appendEvent,
    }
  );
  if (graphResult.status !== 'completed' || !graphResult.state.result) {
    throw new Error('Project agent graph ended without a result.');
  }
  emitAgentStatus(run.id, run.projectId!, { status: 'completed', progress: 100 });
  return {
    checkpoint: graphResult.checkpoint,
    logs: graphResult.state.logs,
    summary: graphResult.state.result.summary,
    output: graphResult.state.result.output,
    // This is the total number of durable domain effects represented by the
    // run, including receipts recovered during a resumed execute node.
    writeActionsCount: graphResult.state.result.writeActionsCount ?? 0,
  };
}

export async function processProjectAgentRunQueue(
  options: {
    runId?: string;
    organizationId?: string;
    projectId?: string;
    limit?: number;
    providerApiKey?: string | null;
  } = {}
) {
  return processDurableProjectAgentRuns({
    runId: options.runId,
    organizationId: options.organizationId,
    projectId: options.projectId,
    limit: options.limit,
    execute: (run, lease) => executeClaimedProjectAgentRun(run, lease, options.providerApiKey),
    classifyError: classifyAgentError,
  });
}

export type ProjectAgentStartParams = {
  projectId: string;
  organizationId: string;
  projectKey: string;
  userId: string;
  kind: AgentRunKind;
  workspaceSettings: WorkspaceAgentSettings;
  projectSettings: ProjectAgentSettings;
  systemControl: SystemAgentControlSettings;
  dryRun?: boolean;
  selectedModelConfig?: AgentModelConfigRecord | null;
  idempotencyKey: string;
};

export async function enqueueProjectAgentRun(
  params: ProjectAgentStartParams
): Promise<RunResponse> {
  const effectiveSettings = resolveEffectiveProjectAgentSettings(
    params.workspaceSettings,
    params.projectSettings,
    params.systemControl
  );
  const executionPolicy = resolveAgentExecutionPolicy({
    kind: params.kind,
    requestedDryRun: Boolean(params.dryRun),
    allowWriteActions: effectiveSettings.allowWriteActions,
    requireApprovalForWrites: effectiveSettings.requireApprovalForWrites,
    aiOversight: effectiveSettings.aiOversight,
  });
  const { dryRun, forcedDryRun, approvalRequired, disposition: writeDisposition } = executionPolicy;
  const input: DurableProjectAgentInput = {
    kind: params.kind,
    projectKey: params.projectKey,
    requestedDryRun: Boolean(params.dryRun),
    forcedDryRun,
    approvalRequired,
    writeDisposition,
    effectiveSettings,
    modelConfig: params.selectedModelConfig
      ? {
          id: params.selectedModelConfig.id,
          name: params.selectedModelConfig.name,
          revisionCount: params.selectedModelConfig.revisionCount,
          settings: params.selectedModelConfig.settings,
        }
      : null,
  };

  const started = await startDurableProjectAgentRun({
    organizationId: params.organizationId,
    projectId: params.projectId,
    initiatedBy: params.userId,
    kind: params.kind,
    mode: effectiveSettings.executionMode,
    dryRun,
    requestedDryRun: Boolean(params.dryRun),
    idempotencyKey: params.idempotencyKey,
    input,
    dailyRunLimit: effectiveSettings.dailyRunLimit,
    maxConcurrentRuns: params.systemControl.maxConcurrentRuns,
  });

  const envelope = serializeProjectAgentRunEnvelope(started.run);
  const output = envelope.output;
  return {
    ...envelope,
    errorCode: typeof output.errorCode === 'string' ? output.errorCode : undefined,
    httpStatus:
      started.run.status === 'failed'
        ? typeof output.httpStatus === 'number'
          ? output.httpStatus
          : 500
        : started.run.status === 'completed'
          ? 200
          : 202,
  };
}

/** Synchronous helper retained for controlled jobs and real-DB verification. */
export async function runProjectAgent(params: ProjectAgentStartParams): Promise<RunResponse> {
  const accepted = await enqueueProjectAgentRun(params);

  const processed = await processProjectAgentRunQueue({
    runId: accepted.run.id,
    organizationId: params.organizationId,
    projectId: params.projectId,
    limit: 1,
  });
  const finalRun =
    processed.run ??
    (await getProjectAgentRun({
      runId: accepted.run.id,
      organizationId: params.organizationId,
      projectId: params.projectId,
    }));
  if (!finalRun) return accepted;
  const output = (finalRun.output as Record<string, unknown>) ?? {};
  const errorCode = typeof output.errorCode === 'string' ? output.errorCode : undefined;
  const httpStatus =
    finalRun.status === 'failed'
      ? typeof output.httpStatus === 'number'
        ? output.httpStatus
        : 500
      : finalRun.status === 'completed'
        ? 200
        : 202;

  return {
    ...serializeProjectAgentRunEnvelope(finalRun),
    errorCode,
    httpStatus,
  };
}

export { ProjectAgentAdmissionError, ProjectAgentIdempotencyConflict };
