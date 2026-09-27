/** @jest-environment node */

jest.mock('./token-crypto', () => ({
  asTokenEnvelope: () => ({ encrypted: true }),
  decryptToken: () => 'xoxb-secret',
}));
jest.mock('./client-credentials', () => ({
  getClientCredentials: async () => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.example.com/api/integrations/slack/callback',
  }),
}));

import { callSlackApi, exchangeSlackCode } from './slack';

describe('Slack outbound request bounds', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: 1 }),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('attaches an abort signal to Web API calls and honors a caller timeout', async () => {
    await expect(
      callSlackApi(
        'views.open',
        { encrypted: true },
        { trigger_id: 'trigger' },
        { timeoutMs: 2_500 }
      )
    ).resolves.toMatchObject({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/views.open',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('also bounds the OAuth code exchange', async () => {
    await exchangeSlackCode('code');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/oauth.v2.access',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
