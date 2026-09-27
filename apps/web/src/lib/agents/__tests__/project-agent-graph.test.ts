/** @jest-environment node */

import {
  createInitialProjectAgentState,
  projectAgentPlanRetryDelayMs,
  runProjectAgentGraph,
  shouldRetryProjectAgentPlan,
} from '../project-agent-graph';
import { AgentExecutionError } from '../providers';
import type { ProjectContext } from '../types';

const context: ProjectContext = {
  project: { id: 'project_1', organizationId: 'org_1', name: 'Nebula', key: 'NEB' },
  issues: [],
  sprints: [],
};

describe('durable project agent graph', () => {
  it('resumes from the persisted plan checkpoint without repeating context or provider work', async () => {
    const loadContext = jest.fn(async () => ({ context, logs: [] }));
    const plan = jest.fn(async ({ logs }) => ({ plan: null, logs }));
    const execute = jest.fn(async ({ logs }) => ({
      result: { summary: 'done', output: { ok: true }, writeActionsCount: 0 },
      logs,
    }));
    const adapters = { loadContext, plan, execute };
    let planCheckpoint:
      | Parameters<NonNullable<Parameters<typeof runProjectAgentGraph>[2]['onCheckpoint']>>[0]
      | undefined;

    await expect(
      runProjectAgentGraph(adapters, createInitialProjectAgentState('project_tracking'), {
        onCheckpoint: async (checkpoint) => {
          if (checkpoint.currentNode === 'execute') {
            planCheckpoint = checkpoint;
            throw new Error('simulated_process_crash');
          }
        },
      })
    ).rejects.toThrow('simulated_process_crash');

    expect(planCheckpoint).toBeDefined();
    const resumed = await runProjectAgentGraph(adapters, planCheckpoint!.state, {
      checkpoint: planCheckpoint,
    });

    expect(resumed.status).toBe('completed');
    expect(loadContext).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('never calls the execute adapter when the finite step bound is exhausted', async () => {
    const adapters = {
      loadContext: jest.fn(async () => ({ context, logs: [] })),
      plan: jest.fn(async ({ logs }) => ({ plan: null, logs })),
      execute: jest.fn(),
    };

    await expect(
      runProjectAgentGraph(adapters, createInitialProjectAgentState('project_tracking'), {
        maxSteps: 1,
      })
    ).rejects.toMatchObject({ code: 'GRAPH_MAX_STEPS' });
    expect(adapters.execute).not.toHaveBeenCalled();
  });

  it('retries only transient provider planning failures with bounded jitter', () => {
    expect(
      shouldRetryProjectAgentPlan(new AgentExecutionError('timeout', 'provider_timeout', 504))
    ).toBe(true);
    expect(
      shouldRetryProjectAgentPlan(
        new AgentExecutionError('rate limited', 'provider_rate_limited', 429)
      )
    ).toBe(true);
    expect(
      shouldRetryProjectAgentPlan(
        new AgentExecutionError('upstream failed', 'provider_server_error', 502)
      )
    ).toBe(true);
    expect(
      shouldRetryProjectAgentPlan(
        new AgentExecutionError('request rejected', 'provider_request_rejected', 502)
      )
    ).toBe(false);
    expect(
      shouldRetryProjectAgentPlan(
        new AgentExecutionError('bad output', 'provider_invalid_output', 502)
      )
    ).toBe(false);
    expect(
      shouldRetryProjectAgentPlan(new AgentExecutionError('bad auth', 'provider_auth_failed', 502))
    ).toBe(false);
    expect(projectAgentPlanRetryDelayMs(20, () => 0.999)).toBeLessThanOrEqual(1_250);
  });

  it('aborts while waiting for a transient plan retry', async () => {
    const controller = new AbortController();
    const adapters = {
      loadContext: jest.fn(async () => ({ context, logs: [] })),
      plan: jest.fn(async () => {
        throw new AgentExecutionError('timeout', 'provider_timeout', 504);
      }),
      execute: jest.fn(),
    };

    await expect(
      runProjectAgentGraph(adapters, createInitialProjectAgentState('project_tracking'), {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'node_retrying') controller.abort(new Error('cancelled'));
        },
      })
    ).rejects.toMatchObject({ code: 'GRAPH_ABORTED' });
    expect(adapters.plan).toHaveBeenCalledTimes(1);
  });

  it('recovers when a transient timeout is followed by a successful plan', async () => {
    const plan = jest
      .fn()
      .mockRejectedValueOnce(new AgentExecutionError('timeout', 'provider_timeout', 504))
      .mockResolvedValue({ plan: null, logs: [] });
    const adapters = {
      loadContext: jest.fn(async () => ({ context, logs: [] })),
      plan,
      execute: jest.fn(async ({ logs }) => ({
        result: { summary: 'done', output: {}, writeActionsCount: 0 },
        logs,
      })),
    };

    const result = await runProjectAgentGraph(
      adapters,
      createInitialProjectAgentState('project_tracking'),
      { maxRuntimeMs: 2_000 }
    );

    expect(result.status).toBe('completed');
    expect(plan).toHaveBeenCalledTimes(2);
  });
});
