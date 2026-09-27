import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentAttentionWidget } from '../agent-attention-widget';
import { useOrganizationAgentSettings } from '@/lib/hooks/use-agents';

jest.mock('@/lib/hooks/use-agents', () => ({
  useOrganizationAgentSettings: jest.fn(),
}));

const mockUseOrganizationAgentSettings = jest.mocked(useOrganizationAgentSettings);
const originalFetch = global.fetch;

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AgentAttentionWidget', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          approvals: [
            { id: 'approval-1', status: 'pending' },
            { id: 'approval-2', status: 'pending' },
          ],
        }),
      } as Response)
    ) as jest.MockedFunction<typeof fetch>;

    mockUseOrganizationAgentSettings.mockReturnValue({
      data: {
        access: { canView: true, canManage: true },
        runtimeSummary: { runningRuns: 1, totalRuns: 12 },
        recentRuns: [
          {
            id: 'run-1',
            kind: 'project_tracking',
            status: 'running',
            summary: 'Requesting a structured agent plan from the configured LLM provider.',
            projectName: 'Atlas',
            createdAt: '2026-08-20T10:00:00.000Z',
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useOrganizationAgentSettings>);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('surfaces review work, running work, and recent agent evidence', async () => {
    const onPendingApprovalCountChange = jest.fn();
    render(
      <Wrapper>
        <AgentAttentionWidget
          organizationId="org-1"
          onPendingApprovalCountChange={onPendingApprovalCountChange}
        />
      </Wrapper>
    );

    expect(await screen.findByText('12')).toBeInTheDocument();
    await waitFor(() => expect(onPendingApprovalCountChange).toHaveBeenLastCalledWith(2));
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Running now')).toBeInTheDocument();
    expect(screen.getByText('Project tracking')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/settings?tab=ai-agents#agent-governance'
    );
  });
});
