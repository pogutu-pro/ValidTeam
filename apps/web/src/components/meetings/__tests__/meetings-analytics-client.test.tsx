import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingsAnalyticsClient } from '../meetings-analytics-client';

const analyticsMock = jest.fn();
let role: string | null = 'admin';

jest.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass,
    ComposedChart: Pass,
    LineChart: Pass,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});
jest.mock('@/lib/hooks/use-organization', () => ({
  useOrganization: () => ({ currentOrganizationId: 'org1' }),
}));
jest.mock('@/lib/hooks/use-members', () => ({
  useOrganizationMembers: () => ({ data: { userRole: role, members: [] } }),
}));
jest.mock('@/lib/hooks/use-meetings', () => ({
  useMeetingAnalytics: (p: unknown) => analyticsMock(p),
}));

const org = {
  volume: { total: 128, scheduled: 4, completed: 120, cancelled: 4, live: 2 },
  attendance: {
    invited: 500,
    attended: 420,
    noShows: 80,
    attendanceRate: 84,
    noShowRate: 16,
    lateArrivalRate: 9.5,
    earlyDepartureRate: null,
  },
  time: {
    totalMeetingHours: 186,
    avgMeetingDurationSeconds: 3120,
    avgAttendanceDurationSeconds: 2700,
  },
  health: { avgPeakParticipants: 6.2, avgInvitedPerMeeting: 7 },
  participation: {
    topHosts: [{ userId: 'u1', name: 'Paul', email: null, hosted: 12 }],
    people: [
      {
        userId: 'u2',
        name: 'Joseph',
        email: null,
        invited: 10,
        attended: 9,
        noShows: 1,
        attendedSeconds: 36000,
        avgAttendancePct: 88.5,
      },
    ],
  },
  trends: [
    {
      bucket: '2026-10-01',
      meetings: 5,
      completed: 5,
      cancelled: 0,
      meetingHours: 6,
      attendanceRate: 80,
      noShowRate: 20,
    },
  ],
};
const me = {
  summary: {
    invited: 10,
    attended: 8,
    missed: 2,
    hosted: 3,
    totalMeetingHours: 9.5,
    avgAttendanceSeconds: 3000,
    avgAttendancePct: 91,
    lateArrivals: 1,
    earlyDepartures: 0,
    totalJoins: 11,
  },
  trend: [{ bucket: '2026-10-01', attended: 4, missed: 1, hours: 3, avgAttendancePct: 90 }],
  history: [
    {
      slug: 'abc',
      title: 'Retro',
      scheduledStartAt: '2026-10-02T10:00:00Z',
      attendedSeconds: 3300,
      attendancePct: 92,
      noShow: false,
    },
  ],
};

describe('MeetingsAnalyticsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    role = 'admin';
    analyticsMock.mockImplementation((p: { scope: string; enabled: boolean }) => ({
      data: !p.enabled ? undefined : p.scope === 'organization' ? org : me,
      isLoading: false,
      isError: false,
    }));
  });

  it('members see only their own analytics, with no organization tab or request', () => {
    role = 'member';
    render(<MeetingsAnalyticsClient />);
    expect(screen.queryByRole('tab', { name: /organization/i })).not.toBeInTheDocument();
    expect(screen.getByText('Attended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /retro/i })).toHaveAttribute('href', '/meetings/abc');
    expect(
      analyticsMock.mock.calls.every(([p]) => p.scope !== 'organization' || p.enabled === false)
    ).toBe(true);
  });

  it('admins can switch to organization KPIs; unavailable rates render as an em dash', async () => {
    render(<MeetingsAnalyticsClient />);
    await userEvent.click(screen.getByRole('tab', { name: /organization/i }));
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('84%')).toBeInTheDocument();
    expect(screen.getByText('186h')).toBeInTheDocument();
    expect(screen.getByText(/left early: —/i)).toBeInTheDocument(); // null rate is not fabricated
    expect(screen.getByText('Joseph')).toBeInTheDocument();
    expect(screen.getByText('Paul')).toBeInTheDocument();
  });

  it('exposes the requested filters and sends them to the API', async () => {
    render(<MeetingsAnalyticsClient />);
    await userEvent.click(screen.getByRole('tab', { name: /organization/i }));
    await userEvent.selectOptions(screen.getByLabelText(/^period/i), 'last90');
    await userEvent.selectOptions(screen.getByLabelText(/recurrence/i), 'true');
    await userEvent.selectOptions(screen.getByLabelText(/guests/i), 'true');
    const last = analyticsMock.mock.calls
      .map(([p]) => p)
      .filter((p) => p.scope === 'organization' && p.enabled)
      .at(-1);
    expect(last).toMatchObject({
      organizationId: 'org1',
      recurring: true,
      external: true,
      bucket: 'week',
    });
    expect(
      ['today', 'week', 'month', 'last30', 'last90', 'custom'].every((v) =>
        screen.getByRole('option', {
          name: new RegExp(
            v === 'last30'
              ? 'last 30'
              : v === 'last90'
                ? 'last 90'
                : v === 'custom'
                  ? 'custom'
                  : v === 'today'
                    ? 'today'
                    : v === 'week'
                      ? 'this week'
                      : 'this month',
            'i'
          ),
        })
      )
    ).toBe(true);
  });

  it('flags an invalid custom range instead of querying', async () => {
    render(<MeetingsAnalyticsClient />);
    await userEvent.selectOptions(screen.getByLabelText(/^period/i), 'custom');
    await userEvent.type(screen.getByLabelText(/^from/i), '2026-10-10');
    await userEvent.type(screen.getByLabelText(/^to/i), '2026-10-01');
    expect(screen.getByRole('alert')).toHaveTextContent(/end date must be after/i);
  });

  it('shows an error state when loading fails', () => {
    analyticsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MeetingsAnalyticsClient />);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load analytics/i);
  });
});
