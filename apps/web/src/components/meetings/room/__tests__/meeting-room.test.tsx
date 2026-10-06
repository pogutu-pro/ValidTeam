import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingRoom } from '../meeting-room';

jest.setTimeout(30_000);

const disconnect = jest.fn();
const setAttributes = jest.fn().mockResolvedValue(undefined);
const sendData = jest.fn().mockResolvedValue(undefined);
const sendChat = jest.fn();
const toggles: Record<string, { enabled: boolean; pending: boolean; toggle: jest.Mock }> = {};
let connection = 'connected';
let participants: Array<Record<string, unknown>> = [];
let attributes: Record<string, Record<string, string>> = {};
let chat: Array<{
  message: string;
  timestamp: number;
  from?: { name?: string; identity: string; isLocal?: boolean };
}> = [];
let dataHandler:
  | ((m: { payload: Uint8Array; from?: { name?: string; identity: string } }) => void)
  | null = null;

jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('livekit-client', () => ({
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
  ConnectionState: {
    Connected: 'connected',
    Reconnecting: 'reconnecting',
    Connecting: 'connecting',
  },
  RoomEvent: { ActiveSpeakersChanged: 'activeSpeakersChanged' },
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
  useLocalParticipant: () => ({ localParticipant: participants.find((p) => p.isLocal) }),
  useParticipantAttributes: ({ participant }: { participant?: { identity: string } }) => ({
    attributes: (participant && attributes[participant.identity]) || {},
  }),
  useRoomContext: () => ({ disconnect, on: jest.fn(), off: jest.fn() }),
  useTrackToggle: ({ source }: { source: string }) => toggles[source],
  useDataChannel: (_topic: string, cb: typeof dataHandler) => {
    dataHandler = cb;
    return { send: sendData, isSending: false };
  },
  useTracks: (sources: unknown[]) =>
    JSON.stringify(sources).includes('withPlaceholder')
      ? participants.map((p) => ({ participant: p, source: 'camera' }))
      : [],
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
  setAttributes,
});

function setup(props: Partial<React.ComponentProps<typeof MeetingRoom>> = {}) {
  const onLeave = jest.fn();
  const onEndForAll = jest.fn().mockResolvedValue(undefined);
  const onRemoveParticipant = jest.fn();
  const view = render(
    <MeetingRoom
      title="Product Planning"
      slug="abc123xyz"
      isHost={false}
      onLeave={onLeave}
      onEndForAll={onEndForAll}
      onRemoveParticipant={onRemoveParticipant}
      {...props}
    />
  );
  return { onLeave, onEndForAll, onRemoveParticipant, ...view };
}

const nav = () => screen.getByRole('navigation', { name: /meeting controls/i });

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
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    document.documentElement.classList.remove('dark');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: jest.fn() },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    connection = 'connected';
    chat = [];
    attributes = {};
    dataHandler = null;
    toggles.microphone = { enabled: true, pending: false, toggle: jest.fn() };
    toggles.camera = { enabled: true, pending: false, toggle: jest.fn() };
    toggles.screen_share = { enabled: false, pending: false, toggle: jest.fn() };
    participants = [
      person('vm:p1:s', 'Paul', 'host', 'p1', true),
      person('vm:p2:s', 'Sarah', 'participant', 'p2'),
      person('vm:p3:s', 'John Smith', 'guest', 'p3'),
    ];
  });

  it('shows the essential controls with accessible names and a prominent red Leave', () => {
    setup();
    for (const name of [
      /mute microphone/i,
      /turn camera off/i,
      /share screen/i,
      /^reactions$/i,
      /raise hand/i,
      /^people$/i,
      /^chat$/i,
      /more options/i,
    ]) {
      expect(within(nav()).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(nav()).getByRole('button', { name: /^leave$/i })).toBeInTheDocument();
    expect(screen.getByText('Product Planning')).toBeInTheDocument();
    expect(screen.getByText(/in meeting: 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/time in meeting/i)).toHaveTextContent('00:00');
  });

  it('forces the dark meeting theme while open and restores it afterwards', () => {
    const { unmount } = setup();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('mic/camera/share toggle with a changed label and aria-pressed (state is not colour-only)', async () => {
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

    toggles.microphone!.enabled = false;
    setup();
    expect(screen.getAllByRole('button', { name: /unmute microphone/i })[0]).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('keyboard shortcuts M, V and H work, but never while typing', async () => {
    setup();
    await userEvent.keyboard('m');
    await userEvent.keyboard('v');
    await userEvent.keyboard('h');
    expect(toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
    expect(toggles.camera!.toggle).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith({ hand: '1' });
    await userEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    await userEvent.type(screen.getByLabelText(/send a message/i), 'mvh');
    expect(toggles.microphone!.toggle).toHaveBeenCalledTimes(1);
  });

  it('raise hand toggles the participant attribute; a raised hand shows on the tile', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /raise hand/i }));
    expect(setAttributes).toHaveBeenCalledWith({ hand: '1' });
    attributes['vm:p2:s'] = { hand: '1' };
    setup();
    expect(screen.getAllByRole('img', { name: /sarah raised a hand/i }).length).toBeGreaterThan(0);
  });

  it('reactions: picking an emoji sends only an allow-listed key and floats locally', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /^reactions$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /applause/i }));
    expect(sendData).toHaveBeenCalledTimes(1);
    const [payload, options] = sendData.mock.calls[0]!;
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ r: 'clap' });
    expect(options).toEqual({ reliable: false });
    expect(within(screen.getByTestId('reaction-overlay')).getByText('👏')).toBeInTheDocument();
  });

  it('reactions: incoming ones render from the allow-list; forged payloads are ignored', async () => {
    setup();
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    act(() =>
      dataHandler!({ payload: enc({ r: 'party' }), from: { name: 'Sarah', identity: 'vm:p2:s' } })
    );
    const overlay = within(screen.getByTestId('reaction-overlay'));
    expect(overlay.getByText('🎉')).toBeInTheDocument();
    expect(overlay.getByText('Sarah')).toBeInTheDocument();
    act(() =>
      dataHandler!({
        payload: enc({ r: '<script>alert(1)</script>' }),
        from: { name: 'Evil', identity: 'x' },
      })
    );
    expect(overlay.queryByText('Evil')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('<script>alert');
  });

  it('pinning a person spotlights them and can be undone', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /pin sarah/i }));
    expect(screen.getByRole('button', { name: /unpin sarah/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: /unpin sarah/i }));
    expect(screen.getByRole('button', { name: /pin sarah/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('with two people the other person fills the stage and you float in a corner', () => {
    participants = [participants[0]!, participants[1]!];
    setup();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText(/paul \(you\)/i)).toBeInTheDocument();
  });

  it('More menu: copy meeting link (no guest token), layout choice, and shortcut hint', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /copy meeting link/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/meet/abc123xyz`
    );

    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menuitemradio', { name: /^grid$/i })).toBeChecked();
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^speaker$/i }));
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menuitemradio', { name: /^speaker$/i })).toBeChecked();
    expect(screen.getByText(/shortcuts:/i)).toBeInTheDocument();
  });

  it('hides screen sharing where the browser cannot do it', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    setup();
    expect(screen.queryByRole('button', { name: /share screen/i })).not.toBeInTheDocument();
  });

  it('leave disconnects and notifies the parent; non-hosts get no end-for-all control', async () => {
    const { onLeave } = setup();
    expect(screen.queryByRole('button', { name: /more leave options/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^leave$/i }));
    expect(disconnect).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });

  it('host: Leave-and-keep-open vs End for everyone (behind a confirmation)', async () => {
    const { onEndForAll, onLeave } = setup({ isHost: true });
    await userEvent.click(screen.getByRole('button', { name: /more leave options/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /end for everyone/i }));
    expect(screen.getByText(/end the meeting for everyone\?/i)).toBeInTheDocument();
    expect(onEndForAll).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /end for everyone/i }));
    await act(async () => {});
    expect(onEndForAll).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });

  it('people panel: search, host section, guest badge, raised hands, host-only removal', async () => {
    attributes['vm:p3:s'] = { hand: '1' };
    const { onRemoveParticipant } = setup({ isHost: true });
    await userEvent.click(screen.getByRole('button', { name: /^people$/i }));
    const panel = screen.getByRole('complementary', { name: /people/i });
    expect(within(panel).getByText('Guest')).toBeInTheDocument();
    expect(within(panel).getAllByRole('img', { name: /john smith raised a hand/i }).length).toBe(1);
    expect(within(panel).queryByRole('button', { name: /remove paul/i })).not.toBeInTheDocument();
    await userEvent.type(within(panel).getByRole('textbox', { name: /search people/i }), 'sar');
    expect(within(panel).queryByText('John Smith')).not.toBeInTheDocument();
    expect(within(panel).getByText('Sarah')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /remove sarah/i }));
    expect(onRemoveParticipant).toHaveBeenCalledWith('p2');
  });

  it('non-hosts never see remove buttons', async () => {
    setup({ isHost: false });
    await userEvent.click(screen.getByRole('button', { name: /^people$/i }));
    expect(screen.queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument();
  });

  it('chat: bubbles, the transient notice, trimmed sends, and unread badge', async () => {
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
