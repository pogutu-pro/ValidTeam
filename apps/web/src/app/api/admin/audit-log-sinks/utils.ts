import { z } from 'zod';
import { isIP } from 'node:net';
import { isPublicNetworkAddress } from '@/lib/agents/provider-endpoint';

export const AUDIT_SINK_TYPES = ['webhook', 'splunk_hec', 'datadog', 's3'] as const;
export type AuditSinkType = (typeof AUDIT_SINK_TYPES)[number];

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    const protocol = url.protocol;
    return (
      protocol === 'https:' ||
      (protocol === 'http:' && process.env.ALLOW_INSECURE_AUDIT_SINKS === 'true')
    );
  }, 'audit_sink_https_required')
  .refine((value) => {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }
    return isIP(hostname) === 0 || isPublicNetworkAddress(hostname);
  }, 'audit_sink_public_destination_required');

const CONFIG_SCHEMAS: Record<AuditSinkType, z.ZodType<Record<string, unknown>>> = {
  webhook: z.object({ url: httpsUrl }).strict(),
  splunk_hec: z
    .object({
      url: httpsUrl,
      token: z.string().trim().min(1).max(4096),
      index: z.string().trim().min(1).max(255).optional(),
    })
    .strict(),
  datadog: z
    .object({
      apiKey: z.string().trim().min(1).max(4096),
      site: z
        .enum([
          'datadoghq.com',
          'us3.datadoghq.com',
          'us5.datadoghq.com',
          'datadoghq.eu',
          'ap1.datadoghq.com',
          'ddog-gov.com',
        ])
        .default('datadoghq.com'),
    })
    .strict(),
  s3: z
    .object({
      bucket: z
        .string()
        .trim()
        .min(3)
        .max(63)
        .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
      region: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/),
      prefix: z
        .string()
        .trim()
        .max(512)
        .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'))
        .optional(),
    })
    .strict(),
};

export function validateSinkConfig(type: AuditSinkType, config: unknown) {
  return CONFIG_SCHEMAS[type].safeParse(config);
}

/**
 * Hide auth tokens from audit-log sink responses so pages never accidentally
 * leak them into the browser bundle/state.
 */
export function redactSinkConfig(
  _type: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...config };
  const SECRET_KEYS = ['token', 'apiKey', 'secret', 'password', 'accessKey', 'secretKey'];
  for (const key of SECRET_KEYS) {
    if (typeof out[key] === 'string' && (out[key] as string).length > 0) {
      out[key] = '••••••••';
    }
  }
  return out;
}
