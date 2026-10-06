import { render, screen, waitFor, within } from '@testing-library/react';
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
  slug: 'abc123xyz',
  title: 'Product Planning',
  status: 'scheduled',
  isInstant: false,
  isRecurring: false,
  scheduledStartAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  scheduledEndAt: new Date(Date.now() + 65 * 60_000).toISOString(),
  timezone: 'UTC',
  joinPath: '/meet/abc123xyz',
  host: { id: 'u1', name: 'Paul', email: 'p@x.io' },
  participantCount: 8,
  isHost: false,
  ...over,
});

const respond = (byScope: Record<string, MeetingListItem[]>) =>
  useMeetingsMock.mockImplementation((_org: string, scope: string) => ({
    data: { meetings: byScope[scope] ?? [], nextOffset: null },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }));

jest.setTimeout(20_000);

describe('MeetingsPageClient', () => {
  beforeAll(() => {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: RO,
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    respond({ upcoming: [item()], live: [] });
  });

  it('puts one big "New meeting" action next to a join-by-code field', () => {
    render(<MeetingsPageClient />);
    expect(screen.getByRole('button', { name: /new meeting/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /enter a code or link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^join$/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /analytics/i })).toHaveAttribute(
      'href',
      '/meetings/analytics'
    );
  });

  it('New meeting menu: instant meeting goes straight to the room', async () => {
    mutate.mockImplementation((_p, opts) => opts.onSuccess({ meeting: { slug: 'newslug00' } }));
    render(<MeetingsPageClient />);
    await userEvent.click(screen.getByRole('button', { name: /new meeting/i }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /start an instant meeting/i })
    );
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        mode: 'instant',
        participantUserIds: [],
        guests: [],
      }),
      expect.anything()
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/meet/newslug00'));
  });

  it('New meeting menu: schedule for later opens the scheduling dialog', async () => {
    render(<MeetingsPageClient />);
    await userEvent.click(screen.getByRole('button', { name: /new meeting/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /schedule for later/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('join by code accepts a bare code or a pasted link (dropping any guest token)', async () => {
    render(<MeetingsPageClient />);
    const field = screen.getByRole('textbox', { name: /enter a code or link/i });
    await userEvent.click(field);
    await userEvent.paste('https://app.test/meet/abcdefgh1234?g=secrettoken');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(push).toHaveBeenCalledWith('/meet/abcdefgh1234');
    push.mockClear();
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste('not a code!');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/valid meeting link or code/i);
  });

  it('shows a Live now strip with a big Join now button', () => {
    respond({
      upcoming: [],
      live: [item({ slug: 'liveslug99', status: 'live', title: 'Standup' })],
    });
    render(<MeetingsPageClient />);
    const section = screen.getByRole('region', { name: /live now/i });
    expect(within(section).getByText('Standup')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /join now/i })).toHaveAttribute(
      'href',
      '/meet/liveslug99'
    );
  });

  it('groups upcoming meetings by day and offers Join when the window is open, Details otherwise', () => {
    const later = new Date(Date.now() + 3 * 86_400_000);
    respond({
      upcoming: [
        item({ slug: 'soonsoon1', title: 'Soon' }),
        item({
          slug: 'latelate1',
          title: 'Later',
          scheduledStartAt: later.toISOString(),
          scheduledEndAt: new Date(later.getTime() + 3_600_000).toISOString(),
        }),
      ],
      live: [],
    });
    render(<MeetingsPageClient />);
    expect(screen.getByText(/^today/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^join$/i })).toHaveAttribute(
      'href',
      '/meet/soonsoon1'
    );
    expect(screen.getByRole('link', { name: /details/i })).toHaveAttribute(
      'href',
      '/meetings/latelate1'
    );
    expect(screen.getAllByText(/hosted by paul/i).length).toBe(2);
  });

  it('empty states are actionable, and errors can be retried', async () => {
    respond({ upcoming: [], past: [], live: [] });
    render(<MeetingsPageClient />);
    expect(screen.getByText(/no upcoming meetings/i)).toBeInTheDocument();
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
