import {
  GRAPH_END,
  runBoundedGraph,
  type GraphCheckpoint,
  type GraphDefinition,
  type GraphRunOptions,
  type GraphRunResult,
} from './graph-runtime';
import type { AgentRunKind } from './config';
import type { AgentProviderPlan } from './providers';
import { AgentExecutionError } from './providers';
import type { ProjectContext } from './types';

export const PROJECT_AGENT_GRAPH_VERSION = 'project-agent-v1';

export type ProjectAgentNodeName = 'load_context' | 'plan' | 'execute';

export type ProjectAgentLogEntry = {
  logIndex: number;
  type: 'system' | 'stdout' | 'stderr';
  content: string;
  timestamp: string;
};

export type ProjectAgentExecutionResult = {
  summary: string;
  writeActionsCount?: number;
  output: Record<string, unknown>;
};

export type SerializableProjectContext = {
  project: ProjectContext['project'];
  issues: Array<Omit<ProjectContext['issues'][number], 'dueDate'> & { dueDate: string | null }>;
  sprints: Array<
    Omit<ProjectContext['sprints'][number], 'startDate' | 'endDate'> & {
      startDate: string;
      endDate: string;
    }
  >;
};

export type ProjectAgentGraphState = {
  kind: AgentRunKind;
  context: SerializableProjectContext | null;
  generatedPlan: AgentProviderPlan | null;
  result: ProjectAgentExecutionResult | null;
  logs: ProjectAgentLogEntry[];
};

export type ProjectAgentGraphAdapters = {
  loadContext: (input: { signal: AbortSignal }) => Promise<{
    context: ProjectContext;
    logs: ProjectAgentLogEntry[];
  }>;
  plan: (input: {
    context: ProjectContext;
    logs: ProjectAgentLogEntry[];
    signal: AbortSignal;
  }) => Promise<{ plan: AgentProviderPlan | null; logs: ProjectAgentLogEntry[] }>;
  execute: (input: {
    context: ProjectContext;
    plan: AgentProviderPlan | null;
    logs: ProjectAgentLogEntry[];
    signal: AbortSignal;
  }) => Promise<{ result: ProjectAgentExecutionResult; logs: ProjectAgentLogEntry[] }>;
};

const TRANSIENT_PLAN_ERROR_CODES = new Set([
  'provider_timeout',
  'provider_unavailable',
  'provider_rate_limited',
  'provider_server_error',
]);

export function shouldRetryProjectAgentPlan(error: unknown): boolean {
  return error instanceof AgentExecutionError && TRANSIENT_PLAN_ERROR_CODES.has(error.code);
}

export function projectAgentPlanRetryDelayMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const base = Math.min(1_000, 100 * 2 ** Math.max(0, attempt - 1));
  return Math.min(1_250, base + Math.floor(random() * 100));
}

export function serializeProjectContext(context: ProjectContext): SerializableProjectContext {
  return {
    project: context.project,
    issues: context.issues.map((issue) => ({
      ...issue,
      dueDate: issue.dueDate?.toISOString() ?? null,
    })),
    sprints: context.sprints.map((sprint) => ({
      ...sprint,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
    })),
  };
}

export function deserializeProjectContext(context: SerializableProjectContext): ProjectContext {
  return {
    project: context.project,
    issues: context.issues.map((issue) => ({
      ...issue,
      dueDate: issue.dueDate ? new Date(issue.dueDate) : null,
    })),
    sprints: context.sprints.map((sprint) => ({
      ...sprint,
      startDate: new Date(sprint.startDate),
      endDate: new Date(sprint.endDate),
    })),
  };
}

export function createInitialProjectAgentState(kind: AgentRunKind): ProjectAgentGraphState {
  return {
    kind,
    context: null,
    generatedPlan: null,
    result: null,
    logs: [],
  };
}

export function createProjectAgentGraph(
  adapters: ProjectAgentGraphAdapters
): GraphDefinition<ProjectAgentGraphState, ProjectAgentNodeName> {
  return {
    version: PROJECT_AGENT_GRAPH_VERSION,
    start: 'load_context',
    nodes: {
      load_context: {
        routes: ['plan'],
        async run({ state, signal }) {
          const loaded = await adapters.loadContext({ signal });
          return {
            state: {
              ...state,
              context: serializeProjectContext(loaded.context),
              logs: loaded.logs,
            },
            next: 'plan',
            progressKey: `context:${loaded.context.project.id}:${loaded.context.issues.length}:${loaded.context.sprints.length}`,
          };
        },
      },
      plan: {
        routes: ['execute'],
        retry: {
          maxAttempts: 3,
          shouldRetry: shouldRetryProjectAgentPlan,
          delayMs: projectAgentPlanRetryDelayMs,
        },
        async run({ state, signal }) {
          if (!state.context) throw new Error('Project context checkpoint is missing.');
          const planned = await adapters.plan({
            context: deserializeProjectContext(state.context),
            logs: [...state.logs],
            signal,
          });
          return {
            state: { ...state, generatedPlan: planned.plan, logs: planned.logs },
            next: 'execute',
            progressKey: `plan:${state.kind}:${planned.plan ? JSON.stringify(planned.plan).length : 0}`,
          };
        },
      },
      execute: {
        routes: [GRAPH_END],
        async run({ state, signal }) {
          if (!state.context) throw new Error('Project context checkpoint is missing.');
          const executed = await adapters.execute({
            context: deserializeProjectContext(state.context),
            plan: state.generatedPlan,
            logs: [...state.logs],
            signal,
          });
          return {
            state: { ...state, result: executed.result, logs: executed.logs },
            next: GRAPH_END,
            progressKey: `execute:${state.kind}:${executed.result.writeActionsCount ?? 0}`,
          };
        },
      },
    },
  };
}

export function runProjectAgentGraph(
  adapters: ProjectAgentGraphAdapters,
  initialState: ProjectAgentGraphState,
  options: GraphRunOptions<ProjectAgentGraphState, ProjectAgentNodeName> = {}
): Promise<GraphRunResult<ProjectAgentGraphState, ProjectAgentNodeName>> {
  return runBoundedGraph(createProjectAgentGraph(adapters), initialState, options);
}

export type ProjectAgentCheckpoint = GraphCheckpoint<ProjectAgentGraphState, ProjectAgentNodeName>;
