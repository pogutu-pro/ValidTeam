/**
 * SCIM bearer-token hashing & verification.
 *
 * We reuse bcryptjs (already a dep) for the hash. Argon2 would be the
 * theoretical best fit but it pulls a native module; bcrypt at 12 rounds is
 * fine for short, machine-generated SCIM tokens since the entropy is in the
 * token itself (32 bytes of CSPRNG), not in user-typed entropy.
 *
 * The plaintext token has the shape `scim_<base64url(32 bytes)>` so admins
 * can recognize it in logs/UIs, similar to `sk_live_...` for API keys.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, scimTokens, organizations, eq, and, isNull, ne } from '@tasknebula/db';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import { hasScimScope, type ScimScope } from '@/lib/scim/scopes';

const TOKEN_PREFIX = 'scim_';
const BCRYPT_COST = 12;
const TOKEN_PATTERN = /^scim_[A-Za-z0-9_-]{43}$/;

export function generateScimToken(): { token: string; prefix: string } {
  const bytes = crypto.randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${bytes}`;
  return { token, prefix: token.slice(0, 12) };
}

export async function hashScimToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST);
}

export function digestScimToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function verifyScimToken(token: string, hash: string): Promise<boolean> {
  if (!token || !hash) return false;
  try {
    return await bcrypt.compare(token, hash);
  } catch {
    return false;
  }
}

export type ScimAuthContext = {
  tokenId: string;
  workspaceId: string;
  scopes: string[];
};

/**
 * Look up & verify a Bearer token from a `Authorization` header value.
 *
 * New tokens use a non-secret deterministic digest to select one bcrypt
 * verifier. Legacy rows without a digest remain supported until rotated.
 * The digest contains enough entropy that it cannot be used as an existence
 * oracle without already knowing the full token.
 */
export async function authenticateScimRequest(
  authorizationHeader: string | null | undefined
): Promise<ScimAuthContext | null> {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match || !match[1]) return null;
  const presented = match[1].trim();
  if (!TOKEN_PATTERN.test(presented)) return null;

  const columns = {
    id: scimTokens.id,
    workspaceId: scimTokens.workspaceId,
    tokenHash: scimTokens.tokenHash,
    scopes: scimTokens.scopes,
  };
  const active = and(isNull(scimTokens.revokedAt), ne(organizations.status, 'suspended'));
  const digest = digestScimToken(presented);
  const indexedCandidates = await db
    .select(columns)
    .from(scimTokens)
    .innerJoin(organizations, eq(organizations.id, scimTokens.workspaceId))
    .where(and(active, eq(scimTokens.tokenDigest, digest)))
    .limit(1);

  // Existing installations cannot backfill a digest because plaintext
  // secrets were intentionally never stored. Only those legacy rows use the
  // old scan path, and disappear from it naturally as admins rotate tokens.
  const candidates = indexedCandidates.length
    ? indexedCandidates
    : await db
        .select({
          id: scimTokens.id,
          workspaceId: scimTokens.workspaceId,
          tokenHash: scimTokens.tokenHash,
          scopes: scimTokens.scopes,
        })
        .from(scimTokens)
        .innerJoin(organizations, eq(organizations.id, scimTokens.workspaceId))
        .where(and(active, isNull(scimTokens.tokenDigest)));

  for (const row of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await verifyScimToken(presented, row.tokenHash);
    if (ok) {
      // Best-effort last-used timestamp; failures are non-fatal.
      try {
        await db
          .update(scimTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(scimTokens.id, row.id));
      } catch {
        /* swallow — last_used_at is purely informational. */
      }
      return { tokenId: row.id, workspaceId: row.workspaceId, scopes: row.scopes };
    }
  }
  return null;
}

export function scimTokenCan(auth: ScimAuthContext, required: ScimScope): boolean {
  return hasScimScope(auth.scopes, required);
}

/**
 * Helper for the settings UI — ensure the caller can manage organization
 * settings in the workspace before they can manage SCIM tokens. Used by REST
 * handlers that mutate the table.
 */
export async function isOrgAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const access = await resolveOrganizationAccess(userId, workspaceId);
  return (
    access.allowed &&
    (access.isSuperAdmin === true || access.role === 'owner' || access.role === 'admin')
  );
}
