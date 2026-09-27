/**
 * Small, dependency-free runtime for bounded and checkpointable agent graphs.
 *
 * This module deliberately owns orchestration only. Nodes own domain work and
 * must treat the supplied AbortSignal as authoritative. Production callers are
 * expected to persist every checkpoint before acknowledging progress.
 */

export const GRAPH_END = '__end__' as const;

export type GraphEnd = typeof GRAPH_END;
export type GraphRoute<NodeName extends string> = NodeName | GraphEnd;

export type GraphRuntimeErrorCode =
  | 'GRAPH_ABORTED'
  | 'GRAPH_CHECKPOINT_VERSION_MISMATCH'
  | 'GRAPH_INVALID_DEFINITION'
  | 'GRAPH_INVALID_ROUTE'
  | 'GRAPH_MAX_NODE_VISITS'
  | 'GRAPH_MAX_STEPS'
  | 'GRAPH_NODE_FAILED'
  | 'GRAPH_NO_PROGRESS'
  | 'GRAPH_TIMEOUT';

export class GraphRuntimeError extends Error {
  constructor(
    public readonly code: GraphRuntimeErrorCode,
    message: string,
    public readonly checkpoint?: GraphCheckpoint<unknown, string>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'GraphRuntimeError';
  }
}

export interface GraphInterruption {
  kind: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface GraphContinueResult<State, NodeName extends string> {
  state: State;
  next: GraphRoute<NodeName>;
  /**
   * A stable description of material progress. Consecutive duplicate keys are
   * treated as a no-progress cycle when the configured bound is reached.
   */
  progressKey?: string;
}

export interface GraphInterruptResult<State, NodeName extends string> {
  state: State;
  interrupt: GraphInterruption;
  /** Node to execute after the caller resumes with an updated checkpoint. */
  resumeAt?: NodeName;
  progressKey?: string;
}

export type GraphNodeResult<State, NodeName extends string> =
  | GraphContinueResult<State, NodeName>
  | GraphInterruptResult<State, NodeName>;

export interface GraphNodeContext<State> {
  state: Readonly<State>;
  signal: AbortSignal;
  step: number;
  attempt: number;
  nodeVisit: number;
}

export interface GraphRetryPolicy {
  /** Total attempts, including the first call. */
  maxAttempts: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  delayMs?: number | ((attempt: number) => number);
}

export interface GraphNodeDefinition<State, NodeName extends string> {
  /** Every route the node may return. Undeclared routes fail closed. */
  routes: readonly GraphRoute<NodeName>[];
  run: (context: GraphNodeContext<State>) => Promise<GraphNodeResult<State, NodeName>>;
  retry?: GraphRetryPolicy;
}

export interface GraphDefinition<State, NodeName extends string> {
  version: string;
  start: NodeName;
  nodes: Record<NodeName, GraphNodeDefinition<State, NodeName>>;
}

export interface GraphCheckpoint<State, NodeName extends string> {
  graphVersion: string;
  currentNode: GraphRoute<NodeName>;
  state: State;
  completedSteps: number;
  nodeVisits: Record<string, number>;
  startedAt: string;
  updatedAt: string;
  lastProgressKey: string | null;
  repeatedProgressCount: number;
}

export type GraphEvent<NodeName extends string> =
  | { type: 'run_started'; graphVersion: string; node: GraphRoute<NodeName>; step: number }
  | { type: 'node_started'; node: NodeName; step: number; attempt: number; visit: number }
  | { type: 'node_retrying'; node: NodeName; step: number; attempt: number; error: string }
  | { type: 'node_completed'; node: NodeName; next: GraphRoute<NodeName>; step: number }
  | { type: 'run_interrupted'; node: NodeName; step: number; interruption: GraphInterruption }
  | { type: 'run_completed'; step: number }
  | { type: 'run_failed'; node: GraphRoute<NodeName>; step: number; code: GraphRuntimeErrorCode };

export interface GraphRunOptions<State, NodeName extends string> {
  checkpoint?: GraphCheckpoint<State, NodeName>;
  signal?: AbortSignal;
  maxSteps?: number;
  maxVisitsPerNode?: number;
  maxRuntimeMs?: number;
  /** Number of consecutive duplicate progress keys tolerated. */
  maxConsecutiveNoProgress?: number;
  onCheckpoint?: (checkpoint: GraphCheckpoint<State, NodeName>) => void | Promise<void>;
  onEvent?: (event: GraphEvent<NodeName>) => void | Promise<void>;
}

export type GraphRunResult<State, NodeName extends string> =
  | {
      status: 'completed';
      state: State;
      checkpoint: GraphCheckpoint<State, NodeName>;
    }
  | {
      status: 'interrupted';
      state: State;
      checkpoint: GraphCheckpoint<State, NodeName>;
      interruption: GraphInterruption;
    };

const DEFAULT_MAX_STEPS = 24;
const DEFAULT_MAX_VISITS_PER_NODE = 6;
const DEFAULT_MAX_RUNTIME_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONSECUTIVE_NO_PROGRESS = 2;

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new GraphRuntimeError('GRAPH_INVALID_DEFINITION', `${label} must be a positive integer.`);
  }
  return resolved;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asUnknownCheckpoint<State, NodeName extends string>(
  checkpoint: GraphCheckpoint<State, NodeName>
): GraphCheckpoint<unknown, string> {
  return checkpoint as unknown as GraphCheckpoint<unknown, string>;
}

export function validateGraphDefinition<State, NodeName extends string>(
  graph: GraphDefinition<State, NodeName>
): void {
  if (!graph.version.trim()) {
    throw new GraphRuntimeError('GRAPH_INVALID_DEFINITION', 'Graph version is required.');
  }

  const nodeNames = new Set(Object.keys(graph.nodes));
  if (!nodeNames.has(graph.start)) {
    throw new GraphRuntimeError(
      'GRAPH_INVALID_DEFINITION',
      `Start node "${graph.start}" is not defined.`
    );
  }

  for (const [nodeName, node] of Object.entries(graph.nodes) as Array<
    [NodeName, GraphNodeDefinition<State, NodeName>]
  >) {
    if (node.routes.length === 0) {
      throw new GraphRuntimeError(
        'GRAPH_INVALID_DEFINITION',
        `Node "${nodeName}" must declare at least one route.`
      );
    }
    for (const route of node.routes) {
      if (route !== GRAPH_END && !nodeNames.has(route)) {
        throw new GraphRuntimeError(
          'GRAPH_INVALID_DEFINITION',
          `Node "${nodeName}" declares unknown route "${route}".`
        );
      }
    }
    if (node.retry) {
      positiveInteger(node.retry.maxAttempts, 1, `${nodeName}.retry.maxAttempts`);
    }
  }
}

function makeInitialCheckpoint<State, NodeName extends string>(
  graph: GraphDefinition<State, NodeName>,
  state: State,
  timestamp: string
): GraphCheckpoint<State, NodeName> {
  return {
    graphVersion: graph.version,
    currentNode: graph.start,
    state,
    completedSteps: 0,
    nodeVisits: {},
    startedAt: timestamp,
    updatedAt: timestamp,
    lastProgressKey: null,
    repeatedProgressCount: 0,
  };
}

function updateProgress<State, NodeName extends string>(
  checkpoint: GraphCheckpoint<State, NodeName>,
  progressKey: string | undefined
): Pick<GraphCheckpoint<State, NodeName>, 'lastProgressKey' | 'repeatedProgressCount'> {
  if (!progressKey) {
    return { lastProgressKey: null, repeatedProgressCount: 0 };
  }
  if (checkpoint.lastProgressKey === progressKey) {
    return {
      lastProgressKey: progressKey,
      repeatedProgressCount: checkpoint.repeatedProgressCount + 1,
    };
  }
  return { lastProgressKey: progressKey, repeatedProgressCount: 0 };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('Graph run was aborted.'));
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new GraphRuntimeError('GRAPH_ABORTED', 'Graph run was aborted.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    timeout.unref?.();
  });
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('Graph run was aborted.'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new Error('Graph run was aborted.'));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

/**
 * Execute a typed graph with explicit routes, finite bounds and resumable
 * checkpoints. The runtime never persists implicitly; callers choose the
 * durable store through `onCheckpoint`.
 */
export async function runBoundedGraph<State, NodeName extends string>(
  graph: GraphDefinition<State, NodeName>,
  initialState: State,
  options: GraphRunOptions<State, NodeName> = {}
): Promise<GraphRunResult<State, NodeName>> {
  validateGraphDefinition(graph);

  const maxSteps = positiveInteger(options.maxSteps, DEFAULT_MAX_STEPS, 'maxSteps');
  const maxVisitsPerNode = positiveInteger(
    options.maxVisitsPerNode,
    DEFAULT_MAX_VISITS_PER_NODE,
    'maxVisitsPerNode'
  );
  const maxRuntimeMs = positiveInteger(
    options.maxRuntimeMs,
    DEFAULT_MAX_RUNTIME_MS,
    'maxRuntimeMs'
  );
  const maxNoProgress = positiveInteger(
    options.maxConsecutiveNoProgress,
    DEFAULT_MAX_CONSECUTIVE_NO_PROGRESS,
    'maxConsecutiveNoProgress'
  );

  const now = new Date();
  let checkpoint = options.checkpoint
    ? structuredClone(options.checkpoint)
    : makeInitialCheckpoint(graph, initialState, now.toISOString());

  if (checkpoint.graphVersion !== graph.version) {
    throw new GraphRuntimeError(
      'GRAPH_CHECKPOINT_VERSION_MISMATCH',
      `Checkpoint graph version "${checkpoint.graphVersion}" does not match "${graph.version}".`,
      asUnknownCheckpoint(checkpoint)
    );
  }

  const startedAtMs = Date.parse(checkpoint.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new GraphRuntimeError(
      'GRAPH_INVALID_DEFINITION',
      'Checkpoint startedAt must be an ISO timestamp.',
      asUnknownCheckpoint(checkpoint)
    );
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  // Bound active execution for this invocation. Time spent paused at a durable
  // HITL checkpoint must not consume the next invocation's execution budget.
  // Step and visit counters remain cumulative across resumes.
  const remainingRuntimeMs = maxRuntimeMs;
  let deadlineReached = false;
  const deadline = setTimeout(() => {
    deadlineReached = true;
    controller.abort(new Error('Graph deadline exceeded'));
  }, remainingRuntimeMs);
  deadline.unref?.();

  const emit = async (event: GraphEvent<NodeName>) => {
    await options.onEvent?.(event);
  };

  const fail = async (
    code: GraphRuntimeErrorCode,
    message: string,
    cause?: unknown
  ): Promise<never> => {
    await emit({
      type: 'run_failed',
      node: checkpoint.currentNode,
      step: checkpoint.completedSteps,
      code,
    });
    throw new GraphRuntimeError(
      code,
      message,
      asUnknownCheckpoint(checkpoint),
      cause === undefined ? undefined : { cause }
    );
  };

  try {
    await emit({
      type: 'run_started',
      graphVersion: graph.version,
      node: checkpoint.currentNode,
      step: checkpoint.completedSteps,
    });

    if (checkpoint.currentNode === GRAPH_END) {
      await emit({ type: 'run_completed', step: checkpoint.completedSteps });
      return { status: 'completed', state: checkpoint.state, checkpoint };
    }

    while (checkpoint.currentNode !== GRAPH_END) {
      if (deadlineReached) {
        await fail('GRAPH_TIMEOUT', `Graph exceeded its ${maxRuntimeMs}ms runtime limit.`);
      }
      if (controller.signal.aborted) {
        await fail('GRAPH_ABORTED', 'Graph run was aborted.', controller.signal.reason);
      }
      if (checkpoint.completedSteps >= maxSteps) {
        await fail('GRAPH_MAX_STEPS', `Graph exceeded its ${maxSteps}-step limit.`);
      }

      const nodeName: NodeName = checkpoint.currentNode;
      const node = graph.nodes[nodeName];
      if (!node) {
        await fail('GRAPH_INVALID_ROUTE', `Checkpoint points to unknown node "${nodeName}".`);
      }

      const visit = (checkpoint.nodeVisits[nodeName] ?? 0) + 1;
      if (visit > maxVisitsPerNode) {
        await fail(
          'GRAPH_MAX_NODE_VISITS',
          `Node "${nodeName}" exceeded its ${maxVisitsPerNode}-visit limit.`
        );
      }

      let attempt = 1;
      let result: GraphNodeResult<State, NodeName> | undefined;
      while (result === undefined) {
        await emit({
          type: 'node_started',
          node: nodeName,
          step: checkpoint.completedSteps + 1,
          attempt,
          visit,
        });
        try {
          result = await raceWithAbort(
            node.run({
              state: checkpoint.state,
              signal: controller.signal,
              step: checkpoint.completedSteps + 1,
              attempt,
              nodeVisit: visit,
            }),
            controller.signal
          );
          break;
        } catch (error) {
          if (deadlineReached) {
            await fail(
              'GRAPH_TIMEOUT',
              `Graph exceeded its ${maxRuntimeMs}ms runtime limit.`,
              error
            );
          }
          if (controller.signal.aborted) {
            await fail('GRAPH_ABORTED', 'Graph run was aborted.', error);
          }

          const retry = node.retry;
          if (!retry || attempt >= retry.maxAttempts || !retry.shouldRetry(error, attempt)) {
            await fail(
              'GRAPH_NODE_FAILED',
              `Node "${nodeName}" failed on attempt ${attempt}: ${errorMessage(error)}`,
              error
            );
          }
          await emit({
            type: 'node_retrying',
            node: nodeName,
            step: checkpoint.completedSteps + 1,
            attempt,
            error: errorMessage(error),
          });
          const retryDelay = retry?.delayMs;
          const delayMs =
            typeof retryDelay === 'function' ? retryDelay(attempt) : (retryDelay ?? 0);
          try {
            await sleep(Math.max(0, delayMs), controller.signal);
          } catch (error) {
            if (deadlineReached) {
              await fail(
                'GRAPH_TIMEOUT',
                `Graph exceeded its ${maxRuntimeMs}ms runtime limit.`,
                error
              );
            }
            if (controller.signal.aborted) {
              await fail('GRAPH_ABORTED', 'Graph run was aborted.', error);
            }
            throw error;
          }
          attempt += 1;
        }
      }

      const progress = updateProgress(checkpoint, result.progressKey);
      if (progress.repeatedProgressCount >= maxNoProgress) {
        await fail(
          'GRAPH_NO_PROGRESS',
          `Graph repeated progress key "${progress.lastProgressKey}" ${progress.repeatedProgressCount} times.`
        );
      }

      const next = 'interrupt' in result ? (result.resumeAt ?? nodeName) : result.next;
      if (next !== GRAPH_END && !node.routes.includes(next)) {
        await fail(
          'GRAPH_INVALID_ROUTE',
          `Node "${nodeName}" returned undeclared route "${next}".`
        );
      }

      const updatedAt = new Date().toISOString();
      checkpoint = {
        ...checkpoint,
        currentNode: next,
        state: result.state,
        completedSteps: checkpoint.completedSteps + 1,
        nodeVisits: { ...checkpoint.nodeVisits, [nodeName]: visit },
        updatedAt,
        ...progress,
      };
      await options.onCheckpoint?.(structuredClone(checkpoint));

      if ('interrupt' in result) {
        await emit({
          type: 'run_interrupted',
          node: nodeName,
          step: checkpoint.completedSteps,
          interruption: result.interrupt,
        });
        return {
          status: 'interrupted',
          state: checkpoint.state,
          checkpoint,
          interruption: result.interrupt,
        };
      }

      await emit({
        type: 'node_completed',
        node: nodeName,
        next: result.next,
        step: checkpoint.completedSteps,
      });
    }

    await emit({ type: 'run_completed', step: checkpoint.completedSteps });
    return { status: 'completed', state: checkpoint.state, checkpoint };
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
