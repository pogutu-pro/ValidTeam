import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingRoom } from '../meeting-room';

const disconnect = jest.fn();
const toggles: Record<string, { enabled: boolean; pending: boolean; toggle: jest.Mock }> = {};
let connection = 'connected';
let participants: Array<Record<string, unknown>> = [];
let chat: Array<{
  message: string;
  timestamp: number;
  from?: { name?: string; identity: string };
}> = [];
const sendChat = jest.fn();

jest.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
  ConnectionState: {
    Connected: 'connected',
    Reconnecting: 'reconnecting',
    Connecting: 'connecting',
  },
}));

jest.mock('@livekit/components-react', () => ({
  RoomAudioRenderer: () => null,
  VideoTrack: () => <div data-testid="video" />,
  isTrackReference: (t: { publication?: unknown }) => Boolean(t.publication),
  useChat: () => ({ chatMessages: chat, send: sendChat, isSending: false }),
  useConnectionState: () => connection,
  useIsMuted: () => false,
  useIsSpeaking: () => false,
  useParticipants: () => participants,
  useRoomContext: () => ({ disconnect }),
  useTrackToggle: ({ source }: { source: string }) => toggles[source],
  useTracks: (sources: unknown[]) =>
    JSON.stringify(sources).includes('screen_share') &&
    !JSON.stringify(sources).includes('withPlaceholder')
      ? []
      : participants.map((p) => ({ participant: p, source: 'camera' })),
}));

const person = (
  identity: string,
  name: string,
  role: string,
  participantId?: string,
  isLocal = false
) => ({
  identity,
  name,
  isLocal,
  metadata: JSON.stringify({ role, participantId }),
});

function setup(props: Partial<React.ComponentProps<typeof MeetingRoom>> = {}) {
  const onLeave = jest.fn();
  const onEndForAll = jest.fn().mockResolvedValue(undefined);
  const onRemoveParticipant = jest.fn();
  render(
    <MeetingRoom
      title="Product Planning"
      isHost={false}
      onLeave={onLeave}
      onEndForAll={onEndForAll}
      onRemoveParticipant={onRemoveParticipant}
      {...props}
    />
  );
  return { onLeave, onEndForAll, onRemoveParticipant };
}

describe('MeetingRoom', () => {
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
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: jest.fn() },
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    connection = 'connected';
    chat = [];
    toggles.microphone = { enabled: true, pending: false, toggle: jest.fn() };
    toggles.camera = { enabled: true, pending: false, toggle: jest.fn() };
    toggles.screen_share = { enabled: false, pending: false, toggle: jest.fn() };
    participants = [
      person('vm:p1:s', 'Paul', 'host', 'p1', true),
      person('vm:p2:s', 'Sarah', 'participant', 'p2'),
      person('vm:p3:s', 'John Smith', 'guest', 'p3'),
    ];
  });

  it('shows the essential controls with accessible names, and a clearly separate Leave', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: /meeting controls/i });
    for (const name of [
      /mute microphone/i,
      /turn camera off/i,
      /share screen/i,
      /^people$/i,
      /^chat$/i,
    ]) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('button', { name: /^leave$/i })).toBeInTheDocument();
    expect(screen.getByText('Product Planning')).toBeInTheDocument();
    expect(screen.getByText(/in meeting: 3/i)).toBeInTheDocument();
  });

  it('toggles mic, camera and screen share, reporting state via aria-pressed and a changed label', async () => {
    setup();
    expect(screen.getByRole('button', { name: /mute microphone/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: /mute microphone/i }));
    await userEvent.click(screen.getByRole('button', { name: /turn camera off/i }));
    await userEvent.click(screen.getByRole('button', { name: /share screen/i }));
    expect(toggles.microphone!.toggle).toHaveBeenCalled();
    expect(toggles.camera!.toggle).toHaveBeenCalled();
    expect(toggles.screen_share!.toggle).toHaveBeenCalled();
  });

  it('supports M and V keyboard shortcuts but not while typing', async () => {
    setup();
    await userEvent.keyboard('m');
    await userEvent.keyboard('v');
    expect(toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
    expect(toggles.camera!.toggle).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    await userEvent.type(screen.getByLabelText(/send a message/i), 'mmm');
    expect(toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
  });

  it('hides screen sharing where the browser cannot do it', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    setup();
    expect(screen.queryByRole('button', { name: /share screen/i })).not.toBeInTheDocument();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: jest.fn() },
    });
  });

  it('leaves: disconnects and notifies the parent', async () => {
    const { onLeave } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^leave$/i }));
    expect(disconnect).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });

  it('only hosts get End for everyone, behind a confirmation', async () => {
    const guestView = setup();
    expect(screen.queryByRole('button', { name: /end for everyone/i })).not.toBeInTheDocument();
    expect(guestView.onEndForAll).not.toHaveBeenCalled();
  });

  it('host: confirms, ends for all, then leaves', async () => {
    const { onEndForAll, onLeave } = setup({ isHost: true });
    await userEvent.click(screen.getByRole('button', { name: /end for everyone/i }));
    expect(screen.getByText(/end the meeting for everyone\?/i)).toBeInTheDocument();
    expect(onEndForAll).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /end for everyone/i }));
    await act(async () => {});
    expect(onEndForAll).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });

  it('participants panel: host section, guest badge, and removal only for hosts', async () => {
    const { onRemoveParticipant } = setup({ isHost: true });
    await userEvent.click(screen.getByRole('button', { name: /^people$/i }));
    const panel = screen.getByRole('complementary', { name: /people/i });
    expect(within(panel).getByText('Paul')).toBeInTheDocument();
    expect(within(panel).getByText('John Smith')).toBeInTheDocument();
    expect(within(panel).getByText('Guest')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /remove paul/i })).not.toBeInTheDocument(); // host/self
    await userEvent.click(within(panel).getByRole('button', { name: /remove john smith/i }));
    expect(onRemoveParticipant).toHaveBeenCalledWith('p3');
  });

  it('non-hosts never see remove buttons', async () => {
    setup({ isHost: false });
    await userEvent.click(screen.getByRole('button', { name: /^people$/i }));
    expect(screen.queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument();
  });

  it('chat: shows messages with the transient notice, sends trimmed text, and badges unread', async () => {
    chat = [{ message: 'hello team', timestamp: 1, from: { name: 'Sarah', identity: 'vm:p2:s' } }];
    setup();
    expect(screen.getByRole('button', { name: /^chat$/i })).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    expect(screen.getByText('hello team')).toBeInTheDocument();
    expect(screen.getByText(/not saved/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/send a message/i), '  hi all  {enter}');
    expect(sendChat).toHaveBeenCalledWith('hi all');
  });

  it('announces reconnecting without blocking the UI', () => {
    connection = 'reconnecting';
    setup();
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
    expect(screen.getByRole('button', { name: /^leave$/i })).toBeEnabled();
  });
});
