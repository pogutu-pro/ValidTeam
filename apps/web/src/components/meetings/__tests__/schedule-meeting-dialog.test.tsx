import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleMeetingDialog } from '../schedule-meeting-dialog';
import { MeetingApiError } from '@/lib/hooks/use-meetings';

const push = jest.fn();
const mutate = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/hooks/use-members', () => ({
  useOrganizationMembers: () => ({
    data: {
      members: [
        { id: 'u1', name: 'Joseph', email: 'j@x.io', status: 'active', memberStatus: 'active' },
        { id: 'u2', name: 'Sarah', email: 's@x.io', status: 'active', memberStatus: 'active' },
        {
          id: 'bot',
          name: 'Claude',
          email: null,
          status: 'active',
          memberStatus: 'active',
          isAgent: true,
        },
      ],
    },
  }),
}));
jest.mock('@/lib/hooks/use-meetings', () => ({
  ...jest.requireActual('@/lib/hooks/use-meetings'),
  useCreateMeeting: () => ({ mutate, isPending: false }),
}));

jest.setTimeout(30_000);

const open = () =>
  render(<ScheduleMeetingDialog open onOpenChange={jest.fn()} organizationId="org1" />);

describe('ScheduleMeetingDialog', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });
  });
  beforeEach(() => jest.clearAllMocks());

  it('requires a title and does not call the API', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a meeting title/i);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('rejects invalid guest e-mails and past start times', async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^title/i), 'Planning');
    await userEvent.type(screen.getByLabelText(/external guests/i), 'ok@x.io, nope');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/nope/);

    await userEvent.clear(screen.getByLabelText(/external guests/i));
    await userEvent.clear(screen.getByLabelText(/^date/i));
    await userEvent.type(screen.getByLabelText(/^date/i), '2020-01-01');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/in the past/i);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('lists only human members and submits people, guests, zone and recurrence', async () => {
    open();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^title/i), 'Weekly sync');
    await userEvent.click(screen.getByRole('checkbox', { name: /joseph/i }));
    await userEvent.type(screen.getByLabelText(/external guests/i), 'Client@Co.io');
    await userEvent.selectOptions(screen.getByLabelText(/^repeat/i), 'weekly');
    await userEvent.type(screen.getByLabelText(/occurrences/i), '8');
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), 'Africa/Nairobi');
    await userEvent.selectOptions(screen.getByLabelText(/duration/i), '30');
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      organizationId: 'org1',
      title: 'Weekly sync',
      mode: 'scheduled',
      durationMinutes: 30,
      timezone: 'Africa/Nairobi',
      participantUserIds: ['u1'],
      guests: [{ email: 'client@co.io' }],
      recurrence: { freq: 'weekly', interval: 1, count: 8 },
      allowGuests: true,
    });
    expect(new Date(payload.startAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('navigates to the meeting on success and explains server rejections', async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^title/i), 'X');
    mutate.mockImplementationOnce((_p, o) =>
      o.onError(new MeetingApiError('invalid_participants', 400, 'x'))
    );
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not members of this workspace/i);

    mutate.mockImplementationOnce((_p, o) => o.onSuccess({ meeting: { slug: 'slug1' } }));
    await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/meetings/slug1'));
  });
});
