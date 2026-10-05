import crypto from 'node:crypto';
import { auth } from '@/auth';
import { apiKeys, db, organizationMembers, organizations, users } from '@validteam/db';
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';

export type ApiActor = {
  userId: string;
  /** API keys are permanently bounded to one organization; sessions are not. */
  organizationId: string | null;
  authType: 'session' | 'api_key';
  apiKeyId?: string;
};

function presentedApiKey(request: Request): { supplied: boolean; value: string | null } {
  // Route unit tests and a few internal callers use minimal Request-shaped
  // objects. Missing headers means "no programmatic credential", matching a
  // normal browser-session request; real Fetch/Next requests always provide
  // this interface.
  const headers = request?.headers;
  if (!headers || typeof headers.get !== 'function') {
    return { supplied: false, value: null };
  }
  const explicit = headers.get('x-api-key');
  const authorization = headers.get('authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? null;

  if (explicit !== null) {
    const value = explicit.trim();
    if (
      !value.startsWith('sk_live_') ||
      value.length <= 'sk_live_'.length ||
      (bearer && bearer !== value)
    ) {
      return { supplied: true, value: null };
    }
    return { supplied: true, value };
  }

  if (authorization !== null) {
    if (!bearer?.startsWith('sk_live_')) return { supplied: true, value: null };
    return { supplied: true, value: bearer };
  }

  return { supplied: false, value: null };
}

/**
 * Resolve the caller for REST routes shared by the browser and MCP.
 *
 * A supplied programmatic credential never falls back to a browser session:
 * malformed/revoked keys fail closed instead of becoming a confused-deputy
 * path. API-key actors retain the creator's current identity and membership,
 * while the key's organization remains an additional immutable boundary.
 */
export async function resolveApiActor(request: Request): Promise<ApiActor | null> {
  const presented = presentedApiKey(request);
  if (!presented.supplied) {
    const session = await auth();
    return session?.user?.id
      ? { userId: session.user.id, organizationId: null, authType: 'session' }
      : null;
  }
  if (!presented.value) return null;

  const hashedKey = crypto.createHash('sha256').update(presented.value).digest('hex');
  const now = new Date();
  const [credential] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      userId: apiKeys.createdBy,
    })
    .from(apiKeys)
    .innerJoin(users, and(eq(users.id, apiKeys.createdBy), eq(users.status, 'active')))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, apiKeys.createdBy),
        eq(organizationMembers.organizationId, apiKeys.organizationId),
        eq(organizationMembers.status, 'active')
      )
    )
    .innerJoin(
      organizations,
      and(eq(organizations.id, apiKeys.organizationId), ne(organizations.status, 'suspended'))
    )
    .where(
      and(
        eq(apiKeys.key, hashedKey),
        eq(apiKeys.isActive, true),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
      )
    )
    .limit(1);

  if (!credential) return null;

  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, credential.id));

  return {
    userId: credential.userId,
    organizationId: credential.organizationId,
    authType: 'api_key',
    apiKeyId: credential.id,
  };
}

export function apiActorCanAccessOrganization(actor: ApiActor, organizationId: string): boolean {
  return actor.organizationId === null || actor.organizationId === organizationId;
}
