import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoadmapPage from '../page';

async function renderPage(projectId: string) {
  const page = await RoadmapPage({ params: Promise.resolve({ projectId }) });
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(page);
  });
  return result!;
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const fetchMock = jest.fn();

describe('RoadmapPage (smoke)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockToast.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders empty state when the API returns no epics', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [] }),
    });

    await renderPage('p1');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /initiatives/i })).toBeInTheDocument();
    });
    expect(await screen.findByText(/no initiatives yet/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/issues?projectId=p1&type=epic')
    );
  });

  it('renders epic titles when the API returns data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issues: [
          {
            id: 'epic-1',
            title: 'Launch v1.0',
            description: null,
            status: 'in_progress',
            priority: 'high',
            startDate: '2026-04-01',
            targetDate: '2026-04-30',
          },
        ],
      }),
    });

    await renderPage('p1');

    // There are two renderings (left pane + Gantt bar) — use getAllByText.
    const matches = await screen.findAllByText('Launch v1.0');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a visible alert instead of an empty roadmap when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'));

    await renderPage('p1');

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);
    expect(screen.queryByText(/no initiatives yet/i)).not.toBeInTheDocument();
  });

  it('exposes the selected period and lets keyboard users change it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ issues: [] }),
    });

    await renderPage('p1');

    const quarterly = await screen.findByRole('button', { name: /quarterly/i });
    const weekly = screen.getByRole('button', { name: /weekly/i });
    expect(quarterly).toHaveAttribute('aria-pressed', 'true');

    await user.click(weekly);

    expect(weekly).toHaveAttribute('aria-pressed', 'true');
    expect(quarterly).toHaveAttribute('aria-pressed', 'false');
  });
});
