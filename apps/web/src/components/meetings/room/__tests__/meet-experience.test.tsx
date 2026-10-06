import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetExperience } from '../meet-experience';

const userState = {
  user: { name: 'Ada Lovelace', email: 'ada@x.io' } as { name: string; email: string } | undefined,
  isLoading: false,
};
jest.mock('@/lib/hooks/use-user', () => ({ useUser: () => userState }));
jest.mock('@livekit/components-react', () => ({
  usePreviewTracks: () => undefined,
  LiveKitRoom: ({
    children,
    token,
    serverUrl,
  }: {
    children: React.ReactNode;
    token: string;
    serverUrl: string;
  }) => (
    <div data-testid="lk-room" data-token={token} data-url={serverUrl}>
      {children}
    </div>
  ),
}));
jest.mock('livekit-client', () => ({
  DisconnectReason: { PARTICIPANT_REMOVED: 1, ROOM_DELETED: 2 },
}));
jest.mock('../meeting-room', () => ({
  MeetingRoom: ({
    title,
    isHost,
    onLeave,
  }: {
    title: string;
    isHost: boolean;
    onLeave: () => void;
  }) => (
    <div>
      <span>{`in-room:${title}:${isHost ? 'host' : 'guest'}`}</span>
      <button onClick={onLeave}>leave-now</button>
    </div>
  ),
}));

const calls: Array<{ url: string; init?: RequestInit }> = [];
const respond = (routes: Record<string, { status?: number; body: unknown }>) => {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    const r = key
      ? routes[key]!
      : { status: 404, body: { error: { code: 'not_found', message: 'nope' } } };
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;
};

const GUEST_TOKEN = 'A'.repeat(43);
const preview = {
  meeting: {
    title: 'Product Planning',
    status: 'live',
    scheduledStartAt: '2026-10-07T07:00:00Z',
    host: { name: 'Paul' },
  },
  guest: { name: null },
};

describe('MeetExperience', () => {
  beforeEach(() => {
    calls.length = 0;
    userState.user = { name: 'Ada Lovelace', email: 'ada@x.io' };
    userState.isLoading = false;
    window.history.replaceState(null, '', '/meet/slug123');
  });

  it('guest: previews via token, strips the token from the URL, joins by name and enters the room as guest', async () => {
    window.history.replaceState(null, '', `/meet/slug123?g=${GUEST_TOKEN}`);
    respond({
      '/guest-preview': { body: preview },
      '/guest-join': { body: { url: 'wss://lk.test', token: 'lk-jwt', role: 'guest' } },
    });
    render(<MeetExperience slug="slug123" />);
    expect(await screen.findByText(/joining as a guest/i)).toBeInTheDocument();
    expect(window.location.search).toBe(''); // token no longer in the address bar
    await userEvent.type(screen.getByLabelText(/your name/i), 'John Smith');
    await userEvent.click(screen.getByRole('button', { name: /join meeting/i }));

    expect(await screen.findByText('in-room:Product Planning:guest')).toBeInTheDocument();
    const join = calls.find((c) => c.url.endsWith('/guest-join'))!;
    const body = JSON.parse(String(join.init?.body));
    expect(body).toMatchObject({ token: GUEST_TOKEN, name: 'John Smith' });
    expect(body.clientSessionId).toEqual(expect.any(String));
    expect(screen.getByTestId('lk-room')).toHaveAttribute('data-token', 'lk-jwt');
    expect(calls.some((c) => c.url.endsWith('/api/meetings/slug123'))).toBe(false); // guests never hit member API
  });

  it('guest: invalid link shows a clear, non-leaky message', async () => {
    window.history.replaceState(null, '', `/meet/slug123?g=${GUEST_TOKEN}`);
    respond({
      '/guest-preview': {
        status: 403,
        body: { error: { code: 'invalid_guest_link', message: 'x' } },
      },
    });
    render(<MeetExperience slug="slug123" />);
    expect(await screen.findByText(/this guest link is not valid/i)).toBeInTheDocument();
  });

  it('member: loads details, prefills the account name, and joins as host', async () => {
    respond({
      '/api/meetings/slug123': {
        body: {
          meeting: {
            title: 'Product Planning',
            status: 'scheduled',
            scheduledStartAt: '2026-10-07T07:00:00Z',
            host: { name: 'Paul' },
          },
        },
      },
      '/join': { body: { url: 'wss://lk.test', token: 't', role: 'host' } },
    });
    render(<MeetExperience slug="slug123" />);
    const name = await screen.findByLabelText(/your name/i);
    expect(name).toHaveValue('Ada Lovelace');
    expect(name).toHaveAttribute('readonly');
    await userEvent.click(screen.getByRole('button', { name: /join meeting/i }));
    expect(await screen.findByText('in-room:Product Planning:host')).toBeInTheDocument();
  });

  it('member: unauthenticated users are sent to sign in and returned to the meeting', async () => {
    respond({
      '/api/meetings/slug123': {
        status: 401,
        body: { error: { code: 'unauthorized', message: 'x' } },
      },
    });
    render(<MeetExperience slug="slug123" />);
    const link = await screen.findByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute(
      'href',
      `/auth/signin?callbackUrl=${encodeURIComponent('/meet/slug123')}`
    );
  });

  it('member: other organizations / no access look like "not found"', async () => {
    respond({
      '/api/meetings/slug123': {
        status: 404,
        body: { error: { code: 'not_found', message: 'x' } },
      },
    });
    render(<MeetExperience slug="slug123" />);
    expect(await screen.findByText(/meeting not found/i)).toBeInTheDocument();
  });

  it('ended meetings are not joinable', async () => {
    respond({
      '/api/meetings/slug123': {
        body: {
          meeting: {
            title: 'Old',
            status: 'ended',
            scheduledStartAt: '2026-10-07T07:00:00Z',
            host: { name: 'P' },
          },
        },
      },
    });
    render(<MeetExperience slug="slug123" />);
    expect(await screen.findByText(/this meeting has ended/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join meeting/i })).not.toBeInTheDocument();
  });

  it('maps join failures to helpful messages and keeps the user on the pre-join screen', async () => {
    respond({
      '/api/meetings/slug123': {
        body: {
          meeting: {
            title: 'P',
            status: 'scheduled',
            scheduledStartAt: '2026-10-07T07:00:00Z',
            host: { name: 'P' },
          },
        },
      },
      '/join': { status: 425, body: { error: { code: 'too_early', message: 'x' } } },
    });
    render(<MeetExperience slug="slug123" />);
    await userEvent.click(await screen.findByRole('button', { name: /join meeting/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/has not opened yet/i);
    expect(screen.getByRole('button', { name: /join meeting/i })).toBeEnabled();
  });

  it('after leaving, offers rejoin which reloads the pre-join step', async () => {
    respond({
      '/api/meetings/slug123': {
        body: {
          meeting: {
            title: 'P',
            status: 'live',
            scheduledStartAt: '2026-10-07T07:00:00Z',
            host: { name: 'P' },
          },
        },
      },
      '/join': { body: { url: 'wss://lk.test', token: 't', role: 'participant' } },
    });
    render(<MeetExperience slug="slug123" />);
    await userEvent.click(await screen.findByRole('button', { name: /join meeting/i }));
    await userEvent.click(await screen.findByText('leave-now'));
    expect(await screen.findByText(/you left the meeting/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /rejoin/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /join meeting/i })).toBeInTheDocument()
    );
  });
});
