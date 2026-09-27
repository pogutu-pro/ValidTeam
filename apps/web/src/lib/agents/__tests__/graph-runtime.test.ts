/**
 * @jest-environment node
 */

import {
  GRAPH_END,
  GraphRuntimeError,
  runBoundedGraph,
  validateGraphDefinition,
  type GraphDefinition,
} from '../graph-runtime';

type CounterNode = 'increment' | 'decide' | 'review';
type CounterState = { count: number; approved: boolean | null };

function counterGraph(): GraphDefinition<CounterState, CounterNode> {
  return {
    version: 'counter-v1',
    start: 'increment',
    nodes: {
      increment: {
        routes: ['decide'],
        async run({ state }) {
          const count = state.count + 1;
          return {
            state: { ...state, count },
            next: 'decide',
            progressKey: `count:${count}`,
          };
        },
      },
      decide: {
        routes: ['increment', 'review'],
        async run({ state }) {
          return {
            state,
            next: state.count < 2 ? 'increment' : 'review',
            progressKey: `decide:${state.count}`,
          };
        },
      },
      review: {
        routes: ['review', GRAPH_END],
        async run({ state }) {
          if (state.approved === null) {
            return {
              state,
              resumeAt: 'review',
              interrupt: { kind: 'approval', reason: 'Approval required.' },
              progressKey: 'approval:pending',
            };
          }
          return {
            state,
            next: GRAPH_END,
            progressKey: `approval:${state.approved}`,
          };
        },
      },
    },
  };
}

describe('bounded graph runtime', () => {
  it('routes a conditional cycle, checkpoints, interrupts, and resumes exactly', async () => {
    const checkpoints: number[] = [];
    const interrupted = await runBoundedGraph(
      counterGraph(),
      { count: 0, approved: null },
      {
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint.completedSteps),
      }
    );

    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.state.count).toBe(2);
    expect(interrupted.checkpoint.currentNode).toBe('review');
    expect(checkpoints).toEqual([1, 2, 3, 4, 5]);

    const resumedCheckpoint = {
      ...interrupted.checkpoint,
      state: { ...interrupted.state, approved: true },
    };
    const completed = await runBoundedGraph(counterGraph(), resumedCheckpoint.state, {
      checkpoint: resumedCheckpoint,
    });

    expect(completed.status).toBe('completed');
    expect(completed.state).toEqual({ count: 2, approved: true });
    expect(completed.checkpoint.currentNode).toBe(GRAPH_END);
    expect(completed.checkpoint.completedSteps).toBe(6);
  });

  it('does not charge time paused at a human interrupt against the resume budget', async () => {
    const interrupted = await runBoundedGraph(counterGraph(), {
      count: 0,
      approved: null,
    });
    expect(interrupted.status).toBe('interrupted');

    const resumedCheckpoint = {
      ...interrupted.checkpoint,
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      state: { ...interrupted.state, approved: true },
    };
    const completed = await runBoundedGraph(counterGraph(), resumedCheckpoint.state, {
      checkpoint: resumedCheckpoint,
      maxRuntimeMs: 50,
    });

    expect(completed.status).toBe('completed');
    expect(completed.state.approved).toBe(true);
  });

  it('fails closed when a node returns an undeclared route', async () => {
    const graph: GraphDefinition<{ ok: boolean }, 'start' | 'hidden'> = {
      version: 'bad-route-v1',
      start: 'start',
      nodes: {
        start: {
          routes: [GRAPH_END],
          async run({ state }) {
            return { state, next: 'hidden' };
          },
        },
        hidden: {
          routes: [GRAPH_END],
          async run({ state }) {
            return { state, next: GRAPH_END };
          },
        },
      },
    };

    await expect(runBoundedGraph(graph, { ok: true })).rejects.toMatchObject({
      code: 'GRAPH_INVALID_ROUTE',
    });
  });

  it('terminates a cycle at the global step bound', async () => {
    const graph: GraphDefinition<{ n: number }, 'loop'> = {
      version: 'loop-v1',
      start: 'loop',
      nodes: {
        loop: {
          routes: ['loop'],
          async run({ state }) {
            return {
              state: { n: state.n + 1 },
              next: 'loop',
              progressKey: `n:${state.n + 1}`,
            };
          },
        },
      },
    };

    await expect(
      runBoundedGraph(graph, { n: 0 }, { maxSteps: 3, maxVisitsPerNode: 10 })
    ).rejects.toMatchObject({ code: 'GRAPH_MAX_STEPS' });
  });

  it('terminates a repeated-state loop with the no-progress guard', async () => {
    const graph: GraphDefinition<{ value: string }, 'loop'> = {
      version: 'stalled-v1',
      start: 'loop',
      nodes: {
        loop: {
          routes: ['loop'],
          async run({ state }) {
            return { state, next: 'loop', progressKey: 'unchanged' };
          },
        },
      },
    };

    await expect(
      runBoundedGraph(
        graph,
        { value: 'same' },
        {
          maxConsecutiveNoProgress: 2,
          maxVisitsPerNode: 10,
        }
      )
    ).rejects.toMatchObject({ code: 'GRAPH_NO_PROGRESS' });
  });

  it('retries only errors classified as transient', async () => {
    let attempts = 0;
    const graph: GraphDefinition<{ done: boolean }, 'work'> = {
      version: 'retry-v1',
      start: 'work',
      nodes: {
        work: {
          routes: [GRAPH_END],
          retry: {
            maxAttempts: 3,
            shouldRetry: (error) => error instanceof Error && error.message === 'transient',
          },
          async run({ state }) {
            attempts += 1;
            if (attempts === 1) throw new Error('transient');
            return { state: { ...state, done: true }, next: GRAPH_END };
          },
        },
      },
    };

    const result = await runBoundedGraph(graph, { done: false });
    expect(result.status).toBe('completed');
    expect(result.state.done).toBe(true);
    expect(attempts).toBe(2);
  });

  it('classifies a terminal node failure and emits the failed checkpoint', async () => {
    const graph: GraphDefinition<{ done: boolean }, 'work'> = {
      version: 'terminal-failure-v1',
      start: 'work',
      nodes: {
        work: {
          routes: [GRAPH_END],
          async run() {
            throw new Error('permanent');
          },
        },
      },
    };

    await expect(runBoundedGraph(graph, { done: false })).rejects.toMatchObject({
      code: 'GRAPH_NODE_FAILED',
      checkpoint: { currentNode: 'work', completedSteps: 0 },
    });
  });

  it('propagates cancellation while waiting to retry', async () => {
    const controller = new AbortController();
    const graph: GraphDefinition<{ done: boolean }, 'work'> = {
      version: 'retry-abort-v1',
      start: 'work',
      nodes: {
        work: {
          routes: [GRAPH_END],
          retry: {
            maxAttempts: 3,
            shouldRetry: () => true,
            delayMs: 10_000,
          },
          async run() {
            throw new Error('transient');
          },
        },
      },
    };

    await expect(
      runBoundedGraph(
        graph,
        { done: false },
        {
          signal: controller.signal,
          onEvent(event) {
            if (event.type === 'node_retrying') controller.abort();
          },
        }
      )
    ).rejects.toMatchObject({ code: 'GRAPH_ABORTED' });
  });

  it('enforces wall time even when a node does not observe its signal', async () => {
    const graph: GraphDefinition<{ waiting: boolean }, 'wait'> = {
      version: 'timeout-v1',
      start: 'wait',
      nodes: {
        wait: {
          routes: [GRAPH_END],
          async run() {
            return new Promise(() => undefined);
          },
        },
      },
    };

    await expect(
      runBoundedGraph(graph, { waiting: true }, { maxRuntimeMs: 10 })
    ).rejects.toMatchObject({ code: 'GRAPH_TIMEOUT' });
  });

  it('rejects checkpoints created by a different graph version', async () => {
    const first = await runBoundedGraph(counterGraph(), { count: 0, approved: null });
    expect(first.status).toBe('interrupted');

    const changed = { ...counterGraph(), version: 'counter-v2' };
    await expect(
      runBoundedGraph(changed, first.state, { checkpoint: first.checkpoint })
    ).rejects.toMatchObject({ code: 'GRAPH_CHECKPOINT_VERSION_MISMATCH' });
  });

  it('validates every declared edge before execution', () => {
    const graph = {
      version: 'invalid-v1',
      start: 'start',
      nodes: {
        start: {
          routes: ['missing'],
          async run({ state }: { state: { ok: boolean } }) {
            return { state, next: 'missing' as const };
          },
        },
      },
    } as unknown as GraphDefinition<{ ok: boolean }, 'start'>;

    expect(() => validateGraphDefinition(graph)).toThrow(GraphRuntimeError);
    expect(() => validateGraphDefinition(graph)).toThrow('unknown route');
  });
});
