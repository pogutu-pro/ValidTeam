describe('chat server debug logging', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalChatDebug = process.env.CHAT_DEBUG;
  const originalConsoleLog = console.log;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      configurable: true,
      value: originalNodeEnv,
      writable: true,
    });

    if (originalChatDebug === undefined) {
      delete process.env.CHAT_DEBUG;
    } else {
      process.env.CHAT_DEBUG = originalChatDebug;
    }

    console.log = originalConsoleLog;
    jest.resetModules();
  });

  it('stays silent unless server debugging is explicitly enabled', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      configurable: true,
      value: 'production',
      writable: true,
    });
    delete process.env.CHAT_DEBUG;
    console.log = jest.fn();

    const { chatServerDebug } = await import('../debug');
    chatServerDebug('call.summary.start', { roomId: 'room-1' });

    expect(console.log).not.toHaveBeenCalled();
  });

  it('logs when CHAT_DEBUG is explicitly set to 1', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      configurable: true,
      value: 'production',
      writable: true,
    });
    process.env.CHAT_DEBUG = '1';
    console.log = jest.fn();

    const { chatServerDebug } = await import('../debug');
    chatServerDebug('call.summary.start', { roomId: 'room-1' });

    expect(console.log).toHaveBeenCalledWith('[chat-debug][server] call.summary.start', {
      roomId: 'room-1',
    });
  });
});
