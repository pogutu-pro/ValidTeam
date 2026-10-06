import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingsPageClient } from '../meetings-page-client';
import type { MeetingListItem } from '@/lib/hooks/use-meetings';

const push = jest.fn();
const mutate = jest.fn();
const useMeetingsMock = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/hooks/use-organization', () => ({
  useOrganization: () => ({ currentOrganizationId: 'org1' }),
}));
jest.mock('@/lib/hooks/use-members', () => ({
  useOrganizationMembers: () => ({ data: { members: [] } }),
}));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/hooks/use-meetings', () => ({
  ...jest.requireActual('@/lib/hooks/use-meetings'),
  useMeetings: (...a: unknown[]) => useMeetingsMock(...a),
  useCreateMeeting: () => ({ mutate, isPending: false }),
}));

const item = (over: Partial<MeetingListItem> = {}): MeetingListItem => ({
  slug: 'abc123',
  title: 'Product Planning',
  status: 'live',
  isInstant: false,
  isRecurring: true,
  scheduledStartAt: new Date(Date.now() - 600_000).toISOString(),
  scheduledEndAt: new Date(Date.now() + 3_000_000).toISOString(),
  timezone: 'UTC',
  joinPath: '/meet/abc123',
  host: { id: 'u1', name: 'Paul', email: 'p@x.io' },
  participantCount: 8,
  isHost: false,
  ...over,
});

describe('MeetingsPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMeetingsMock.mockImplementation((_org: string, scope: string) => ({
      data: { meetings: scope === 'past' ? [] : [item()], nextOffset: null },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }));
  });

  it('offers one obvious primary action and a secondary schedule action', () => {
    render(<MeetingsPageClient />);
    expect(screen.getByRole('button', { name: /start a meeting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^schedule$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /analytics/i })).toHaveAttribute(
      'href',
      '/meetings/analytics'
    );
  });

  it('shows title, host, participants, status and a Join link for a live meeting', () => {
    render(<MeetingsPageClient />);
    expect(screen.getByText('Product Planning')).toBeInTheDocument();
    expect(screen.getByText(/hosted by paul/i)).toBeInTheDocument();
    expect(screen.getByText(/participants: 8/i)).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /join/i })).toHaveAttribute('href', '/meet/abc123');
  });

  it('starts an instant meeting and goes straight to the room', async () => {
    mutate.mockImplementation((_payload, opts) => opts.onSuccess({ meeting: { slug: 'newslug' } }));
    render(<MeetingsPageClient />);
    await userEvent.click(screen.getByRole('button', { name: /start a meeting/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        mode: 'instant',
        participantUserIds: [],
        guests: [],
      }),
      expect.anything()
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/meet/newslug'));
  });

  it('shows an actionable empty state for the Past tab and an error state with retry', async () => {
    render(<MeetingsPageClient />);
    await userEvent.click(screen.getByRole('tab', { name: /past/i }));
    expect(screen.getByText(/no past meetings yet/i)).toBeInTheDocument();

    const refetch = jest.fn();
    useMeetingsMock.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }));
    render(<MeetingsPageClient />);
    await userEvent.click(screen.getAllByRole('button', { name: /try again/i })[0]!);
    expect(refetch).toHaveBeenCalled();
  });
});
