import {
  UnsafeAgentProviderEndpointError,
  validatePublicEndpoint,
  type PublicEndpointPolicy,
} from '@/lib/agents/provider-endpoint';

const MAX_WEBHOOK_URL_LENGTH = 2048;

function configuredWebhookHostAllowlist(): string[] {
  return (process.env.VALIDTEAM_WEBHOOK_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function webhookEndpointPolicy(): PublicEndpointPolicy {
  return {
    allowInsecureHttp: process.env.VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP === 'true',
    hostAllowlist: configuredWebhookHostAllowlist(),
  };
}

/**
 * Validate and normalize a customer webhook URL before it is stored. Runtime
 * delivery repeats the public-address lookup and pins the selected answer, so
 * a URL cannot become unsafe later through DNS rebinding or configuration
 * drift.
 */
export async function validateWebhookEndpoint(rawUrl: string): Promise<string> {
  const value = rawUrl.trim();
  if (value.length === 0 || value.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new UnsafeAgentProviderEndpointError('Webhook endpoint is invalid.');
  }
  const endpoint = await validatePublicEndpoint(value, webhookEndpointPolicy());
  return endpoint.toString();
}
