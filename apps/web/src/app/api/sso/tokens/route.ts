/**
 * SCIM token management — list + create.
 *
 *   GET    ?organizationId=xxx          → list non-secret token metadata
 *   POST   { organizationId, name }     → create a token, return the plaintext
 *                                         ONCE; subsequent reads only see the hash.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { auditLogs, db, scimTokens, eq, desc, sql } from '@validteam/db';
import { hasPermission } from '@/lib/auth/permissions';
import { digestScimToken, generateScimToken, hashScimToken } from '@/lib/sso/tokens';
import { SCIM_SCOPES } from '@/lib/scim/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(SCIM_SCOPES))
    .min(1)
    .max(SCIM_SCOPES.length)
    .default([...SCIM_SCOPES]),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const orgId = new URL(request.url).searchParams.get('organizationId');
  if (!orgId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }
  if (!(await hasPermission(orgId, 'org:settings'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rows = await db
    .select({
      id: scimTokens.id,
      name: scimTokens.name,
      tokenPrefix: scimTokens.tokenPrefix,
      scopes: scimTokens.scopes,
      createdAt: scimTokens.createdAt,
      lastUsedAt: scimTokens.lastUsedAt,
      revokedAt: scimTokens.revokedAt,
    })
    .from(scimTokens)
    .where(eq(scimTokens.workspaceId, orgId))
    .orderBy(desc(scimTokens.createdAt));
  return NextResponse.json({ tokens: rows });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await hasPermission(parsed.data.organizationId, 'org:settings'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const scopes = [...new Set(parsed.data.scopes)];
  const { token, prefix } = generateScimToken();
  const tokenHash = await hashScimToken(token);
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`scim-token:${parsed.data.organizationId}`}))`
    );
    const [created] = await tx
      .insert(scimTokens)
      .values({
        workspaceId: parsed.data.organizationId,
        name: parsed.data.name,
        tokenHash,
        tokenDigest: digestScimToken(token),
        tokenPrefix: prefix,
        scopes,
        createdBy: session.user.id,
      })
      .returning({
        id: scimTokens.id,
        name: scimTokens.name,
        tokenPrefix: scimTokens.tokenPrefix,
        scopes: scimTokens.scopes,
        createdAt: scimTokens.createdAt,
      });
    if (!created) throw new Error('scim_token_create_failed');
    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId: parsed.data.organizationId,
      action: 'scim_token.created',
      resourceType: 'scim_token',
      resourceId: created.id,
      changes: { scopes: { from: null, to: scopes } },
      metadata: { name: created.name, tokenPrefix: prefix },
    });
    return created;
  });
  if (!row) {
    return NextResponse.json({ error: 'Failed to persist SCIM token' }, { status: 500 });
  }
  return NextResponse.json(
    {
      token, // shown only once
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      scopes: row.scopes,
      createdAt: row.createdAt,
    },
    { status: 201 }
  );
}
