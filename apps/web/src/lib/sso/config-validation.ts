import crypto from 'node:crypto';

export class SamlConfigValidationError extends Error {
  constructor(
    public readonly code: 'unsafe_entry_point' | 'invalid_certificate' | 'invalid_private_key'
  ) {
    super(code);
    this.name = 'SamlConfigValidationError';
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function normalizeSamlEntryPoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SamlConfigValidationError('unsafe_entry_point');
  }
  const developmentLoopback = process.env.NODE_ENV !== 'production' && isLoopback(url.hostname);
  if (
    (url.protocol !== 'https:' && !(developmentLoopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new SamlConfigValidationError('unsafe_entry_point');
  }
  return url.toString();
}

export function normalizeSamlCertificate(value: string): string {
  const base64 = value
    .trim()
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new SamlConfigValidationError('invalid_certificate');
  }
  const lines = base64.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
  try {
    new crypto.X509Certificate(pem);
  } catch {
    throw new SamlConfigValidationError('invalid_certificate');
  }
  return pem;
}

export function normalizeSamlPrivateKey(value: string): string {
  const key = value.trim();
  try {
    crypto.createPrivateKey(key);
  } catch {
    throw new SamlConfigValidationError('invalid_private_key');
  }
  return key;
}

export function certificateFingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return crypto.createHash('sha256').update(compact, 'utf8').digest('hex');
}
