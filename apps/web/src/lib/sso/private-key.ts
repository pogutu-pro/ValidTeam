import { asTokenEnvelope, decryptToken, encryptToken } from '@/lib/integrations/token-crypto';

const ENCRYPTED_PREFIX = 'tn-sso-key:v1:';

export function protectSsoPrivateKey(value: string): string {
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;
  const encoded = Buffer.from(JSON.stringify(encryptToken(value)), 'utf8').toString('base64url');
  return `${ENCRYPTED_PREFIX}${encoded}`;
}

export function revealSsoPrivateKey(value: string | null): string | null {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64url').toString('utf8')
    );
  } catch {
    throw new Error('Invalid encrypted SSO private-key envelope');
  }
  const envelope = asTokenEnvelope(parsed);
  if (!envelope) throw new Error('Invalid encrypted SSO private-key envelope');
  return decryptToken(envelope);
}

export function isProtectedSsoPrivateKey(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(ENCRYPTED_PREFIX));
}
