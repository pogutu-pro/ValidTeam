/** @jest-environment jsdom */

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
const toastMock = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import {
  createProjectAgentRunIntent,
  getProjectAgentControlAction,
  getProjectAgentRefetchInterval,
  useControlProjectAgentRun,
  useProjectAgents,
  useRunProjectAgent,
} from '../use-agents';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 1, retryDelay: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('project agent run hook idempotency', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    toastMock.mockReset();
    Object.defineProperty(global, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  });

  it('reuses one intent key across TanStack network retries', async () => {
    const intent = createProjectAgentRunIntent({ kind: 'project_tracking', dryRun: false });
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          run: { id: 'run_1', status: 'pending' },
          output: {},
          dryRun: false,
          forcedDryRun: false,
        }),
      });
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useRunProjectAgent('project_1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(intent);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys).toEqual([intent.idempotencyKey, intent.idempotencyKey]);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(secondBody).toEqual({ kind: 'project_tracking', dryRun: false });
    expect(secondBody).not.toHaveProperty('idempotencyKey');
  });

  it('polls only while a durable run is active', () => {
    expect(getProjectAgentRefetchInterval({ recentRuns: [{ status: 'pending' }] } as never)).toBe(
      2_000
    );
    expect(getProjectAgentRefetchInterval({ recentRuns: [{ status: 'cancelled' }] } as never)).toBe(
      false
    );
  });

  it('offers only valid durable control transitions', () => {
    expect(getProjectAgentControlAction('pending')).toBe('cancel');
    expect(getProjectAgentControlAction('running')).toBe('cancel');
    expect(getProjectAgentControlAction('failed')).toBe('resume');
    expect(getProjectAgentControlAction('cancelled')).toBe('resume');
    expect(getProjectAgentControlAction('completed')).toBeNull();
  });

  it('sends a tenant-scoped resume action through the control endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ run: { id: 'run_1', status: 'pending' } }),
    });
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useControlProjectAgentRun('project_1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ runId: 'run_1', action: 'resume' });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project_1/agents/runs/run_1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
  });

  it('notifies once when polling observes an active run reach terminal state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const pendingResponse = {
      recentRuns: [{ id: 'run_1', status: 'pending', dryRun: false }],
    };
    Object.defineProperty(global, 'fetch', {
      value: jest.fn().mockResolvedValue({ ok: true, json: async () => pendingResponse }),
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useProjectAgents('project_1'), {
      wrapper: localWrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      client.setQueryData(['project-ai-agents', 'project_1'], {
        recentRuns: [{ id: 'run_1', status: 'completed', dryRun: false }],
      });
    });

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'projectAi.run_completed',
        variant: undefined,
      })
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
