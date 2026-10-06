/** @jest-environment node */
const receiveMock = jest.fn();
const chatHandlerMock = jest.fn();
const meetingHandlerMock = jest.fn();

jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({ receive: receiveMock })),
}));
jest.mock('@/lib/chat/server', () => ({
  handleLivekitWebhookEvent: (...a: unknown[]) => chatHandlerMock(...a),
}));
jest.mock('@/lib/meetings/webhook', () => ({
  handleMeetingWebhookEvent: (...a: unknown[]) => meetingHandlerMock(...a),
}));

describe('LiveKit webhook room routing', () => {
  const env = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' };
    chatHandlerMock.mockResolvedValue({ handled: true });
    meetingHandlerMock.mockResolvedValue({ handled: true });
  });
  afterAll(() => {
    process.env = env;
  });

  const post = async (event: Record<string, unknown>) => {
    receiveMock.mockResolvedValue(event);
    const { POST } = await import('./route');
    return POST(
      new Request('http://x/api/chat/livekit/webhook', {
        method: 'POST',
        body: '{}',
        headers: { authorization: 'jwt' },
      })
    );
  };

  it('routes vm-* rooms to the meeting handler only', async () => {
    const res = await post({
      event: 'participant_joined',
      room: { name: 'vm-abc' },
      participant: { identity: 'vm:p1:sess1234' },
      createdAt: 1_700_000_000n,
    });
    expect(res.status).toBe(200);
    expect(meetingHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'participant_joined',
        roomName: 'vm-abc',
        participantIdentity: 'vm:p1:sess1234',
      })
    );
    expect(chatHandlerMock).not.toHaveBeenCalled();
  });

  it('maps screen-share track events', async () => {
    await post({
      event: 'track_published',
      room: { name: 'vm-abc' },
      participant: { identity: 'vm:p1:s' },
      track: { source: 3 },
    });
    expect(meetingHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({ trackSource: 'screen_share' })
    );
  });

  it('leaves chat call rooms on the existing handler, untouched', async () => {
    await post({
      event: 'participant_joined',
      room: { name: 'tn-proj-room-xyz' },
      participant: { identity: 'tnp:u:s', metadata: '' },
    });
    expect(chatHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'participant_joined', roomName: 'tn-proj-room-xyz' })
    );
    expect(meetingHandlerMock).not.toHaveBeenCalled();
  });
});
