const resolveLivekitConfigMock = jest.fn();

jest.mock('@/lib/admin/system-settings', () => ({
  resolveLivekitConfig: (...args: unknown[]) => resolveLivekitConfigMock(...args),
}));

jest.mock('livekit-server-sdk', () => ({
  AccessToken: class {},
  RoomServiceClient: class {},
}));

import { resolveLivekitStatus } from '@/lib/chat/livekit';

describe('resolveLivekitStatus', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LIVEKIT_URL;
    delete process.env.NEXT_PUBLIC_LIVEKIT_URL;
    delete process.env.LIVEKIT_PUBLIC_HOST;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports Admin-stored credentials as the runtime source', async () => {
    resolveLivekitConfigMock.mockResolvedValue({
      source: 'db',
      url: 'wss://livekit.admin.example',
      apiKey: 'admin-key',
      apiSecret: 'admin-secret',
    });

    await expect(resolveLivekitStatus()).resolves.toEqual({
      ready: true,
      url: 'wss://livekit.admin.example',
      source: 'db',
      missing: [],
    });
  });

  it('reports every missing field when neither Admin settings nor env fallback exist', async () => {
    resolveLivekitConfigMock.mockResolvedValue(null);

    await expect(resolveLivekitStatus()).resolves.toEqual({
      ready: false,
      url: null,
      source: 'env',
      missing: ['LIVEKIT_URL', 'NEXT_PUBLIC_LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    });
  });
});
