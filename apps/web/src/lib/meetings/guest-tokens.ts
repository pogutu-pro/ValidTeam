import crypto from 'node:crypto';

/** 256-bit random token; only its SHA-256 is persisted. */
export function generateGuestToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashGuestToken(token) };
}

export function hashGuestToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function looksLikeGuestToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Unguessable public meeting identifier (≈ 96 bits). */
export function generateMeetingSlug(): string {
  return crypto.randomBytes(12).toString('base64url');
}
