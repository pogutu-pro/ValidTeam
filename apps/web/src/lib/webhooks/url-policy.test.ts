/** @jest-environment node */

import { validateWebhookEndpoint, webhookEndpointPolicy } from './url-policy';

const originalHttpPolicy = process.env.VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP;
const originalAllowlist = process.env.VALIDTEAM_WEBHOOK_HOST_ALLOWLIST;

afterEach(() => {
  if (originalHttpPolicy === undefined) {
    delete process.env.VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP;
  } else {
    process.env.VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP = originalHttpPolicy;
  }
  if (originalAllowlist === undefined) {
    delete process.env.VALIDTEAM_WEBHOOK_HOST_ALLOWLIST;
  } else {
    process.env.VALIDTEAM_WEBHOOK_HOST_ALLOWLIST = originalAllowlist;
  }
});

describe('customer webhook endpoint policy', () => {
  it('accepts a credential-free public HTTPS endpoint', async () => {
    await expect(validateWebhookEndpoint(' https://8.8.8.8/hooks ')).resolves.toBe(
      'https://8.8.8.8/hooks'
    );
  });

  it('rejects HTTP, embedded credentials, and private destinations by default', async () => {
    await expect(validateWebhookEndpoint('http://8.8.8.8/hooks')).rejects.toThrow(/HTTPS/);
    await expect(validateWebhookEndpoint('https://user:secret@8.8.8.8/hooks')).rejects.toThrow(
      /credentials/
    );
    await expect(validateWebhookEndpoint('https://127.0.0.1/hooks')).rejects.toThrow(/public/);
  });

  it('never opens private destinations when the development HTTP escape hatch is enabled', async () => {
    process.env.VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP = 'true';

    await expect(validateWebhookEndpoint('http://8.8.8.8/hooks')).resolves.toBe(
      'http://8.8.8.8/hooks'
    );
    await expect(validateWebhookEndpoint('http://169.254.169.254/latest')).rejects.toThrow(
      /public/
    );
  });

  it('supports an operator host allowlist as an additional restriction', async () => {
    process.env.VALIDTEAM_WEBHOOK_HOST_ALLOWLIST = '1.1.1.1, *.hooks.example.com';

    expect(webhookEndpointPolicy()).toMatchObject({
      hostAllowlist: ['1.1.1.1', '*.hooks.example.com'],
    });
    await expect(validateWebhookEndpoint('https://1.1.1.1/hooks')).resolves.toBe(
      'https://1.1.1.1/hooks'
    );
    await expect(validateWebhookEndpoint('https://8.8.8.8/hooks')).rejects.toThrow(/allowlisted/);
  });
});
