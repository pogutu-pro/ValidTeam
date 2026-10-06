import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingDetailsClient } from '../meeting-details-client';
import type { MeetingDetail, MeetingStatsResponse } from '@/lib/hooks/use-meetings';

const useMeetingMock = jest.fn();
const statsMock = jest.fn();
const actions = {
  cancel: { mutate: jest.fn(), isPending: false },
  end: { mutate: jest.fn(), isPending: false },
  invite: { mutate: jest.fn(), isPending: false },
  remove: { mutate: jest.fn(), isPending: false },
};

jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/hooks/use-meetings', () => ({
  ...jest.requireActual('@/lib/hooks/use-meetings'),
  useMeeting: () => useMeetingMock(),
  useMeetingStats: () => statsMock(),
  useMeetingAction: () => actions,
}));

const base = (
  over: Partial<MeetingDetail['meeting']> = {},
  you: Partial<MeetingDetail['you']> = {}
): MeetingDetail => ({
  meeting: {
    slug: 'abc',
    title: 'Product Planning',
    description: null,
    status: 'scheduled',
    isInstant: false,
    isRecurring: false,
    access: 'invited',
    allowGuests: true,
    timezone: 'UTC',
    scheduledStartAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    scheduledEndAt: new Date(Date.now() + 65 * 60_000).toISOString(),
    actualStartedAt: null,
    endedAt: null,
    joinPath: '/meet/abc',
    recordingStatus: 'none',
    transcriptionStatus: 'none',
    captionStatus: 'none',
    host: { name: 'Paul' },
    ...over,
  },
  you: { isHost: true, canManage: true, canJoin: true, ...you },
  participants: [
    { participantId: 'h', role: 'host', kind: 'member', name: 'Paul', email: null },
    {
      participantId: 'g',
      role: 'participant',
      kind: 'guest',
      name: 'John Smith',
      email: 'john@client.io',
    },
  ],
});

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
});
beforeEach(() => {
  jest.clearAllMocks();
  statsMock.mockReturnValue({ data: undefined, isLoading: false });
});

describe('MeetingDetailsClient', () => {
  it('host sees the join/start action, copy link, cancel and invite controls for a scheduled meeting', () => {
    useMeetingMock.mockReturnValue({ data: base(), isLoading: false, isError: false });
    render(<MeetingDetailsClient slug="abc" />);
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute('href', '/meet/abc');
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel meeting/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/invite more people/i)).toBeInTheDocument();
    expect(screen.getByText('john@client.io')).toBeInTheDocument();
    // Future-ready media features never render fake controls while inactive.
    expect(screen.queryByText(/recording|transcript|captions/i)).not.toBeInTheDocument();
  });

  it('a plain participant gets no management controls', () => {
    useMeetingMock.mockReturnValue({
      data: base({}, { isHost: false, canManage: false }),
      isLoading: false,
      isError: false,
    });
    render(<MeetingDetailsClient slug="abc" />);
    expect(screen.getByRole('link', { name: /^join/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel meeting/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/invite more people/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
  });

  it('recurring meetings offer this-occurrence and whole-series cancellation', async () => {
    useMeetingMock.mockReturnValue({
      data: base({ isRecurring: true }),
      isLoading: false,
      isError: false,
    });
    render(<MeetingDetailsClient slug="abc" />);
    await userEvent.click(screen.getByRole('button', { name: /cancel meeting/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /whole series/i }));
    expect(actions.cancel.mutate).toHaveBeenCalledWith('series', expect.anything());
  });

  it('invites by e-mail (members are converted server-side) and validates addresses', async () => {
    useMeetingMock.mockReturnValue({ data: base(), isLoading: false, isError: false });
    render(<MeetingDetailsClient slug="abc" />);
    await userEvent.type(screen.getByLabelText(/invite more people/i), 'new@x.io, other@x.io');
    await userEvent.click(screen.getByRole('button', { name: /send invitations/i }));
    expect(actions.invite.mutate).toHaveBeenCalledWith(
      { participantUserIds: [], guests: [{ email: 'new@x.io' }, { email: 'other@x.io' }] },
      expect.anything()
    );
  });

  it('a live meeting can be ended by a manager', async () => {
    useMeetingMock.mockReturnValue({
      data: base({ status: 'live' }),
      isLoading: false,
      isError: false,
    });
    render(<MeetingDetailsClient slug="abc" />);
    await userEvent.click(screen.getByRole('button', { name: /end meeting/i }));
    expect(actions.end.mutate).toHaveBeenCalled();
  });

  it('an ended meeting shows computed analytics and per-person attendance', () => {
    const d = base({ status: 'ended' });
    d.participants[0]!.attendance = {
      firstJoinedAt: '2026-10-07T10:00:00Z',
      lastLeftAt: '2026-10-07T11:00:00Z',
      attendedSeconds: 3000,
      attendancePct: 83.3,
      joinCount: 2,
      lateArrival: false,
      earlyDeparture: false,
      noShow: false,
    };
    d.participants[1]!.attendance = {
      firstJoinedAt: null,
      lastLeftAt: null,
      attendedSeconds: 0,
      attendancePct: 0,
      joinCount: 0,
      lateArrival: false,
      earlyDeparture: false,
      noShow: true,
    };
    useMeetingMock.mockReturnValue({ data: d, isLoading: false, isError: false });
    const stats: MeetingStatsResponse = {
      available: true,
      summary: {
        durationSeconds: 3600,
        invitedCount: 2,
        attendedCount: 1,
        noShowCount: 1,
        peakConcurrent: 1,
        totalParticipantSeconds: 3000,
        avgAttendanceSeconds: 3000,
        avgAttendancePct: 83.3,
        lateArrivals: 0,
        earlyDepartures: 0,
        totalJoins: 2,
        totalLeaves: 2,
      },
    };
    statsMock.mockReturnValue({ data: stats, isLoading: false });
    render(<MeetingDetailsClient slug="abc" />);
    expect(screen.getAllByText('1h 00m').length).toBeGreaterThanOrEqual(2); // overview + KPI
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getAllByText('83.3%', { exact: false }).length).toBeGreaterThanOrEqual(2); // KPI + per-person row
    expect(screen.getByText(/did not attend/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /join|start/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/invite more people/i)).not.toBeInTheDocument();
  });

  it('not-found and error states are explicit', () => {
    useMeetingMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });
    render(<MeetingDetailsClient slug="abc" />);
    expect(screen.getByText(/meeting not found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to meetings/i })).toBeInTheDocument();
  });
});
