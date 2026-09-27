/**
 * SCIM token revocation. Hard delete is intentionally avoided so audit
 * logs / last-used timestamps survive — `revokedAt` is the off switch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { auditLogs, db, scimTokens, eq, sql } from '@tasknebula/db';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const [row] = await db
    .select({ workspaceId: scimTokens.workspaceId })
    .from(scimTokens)
    .where(eq(scimTokens.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }
  if (!(await hasPermission(row.workspaceId, 'org:settings'))) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scim-token:${id}`}))`);
    const [locked] = await tx
      .select({
        id: scimTokens.id,
        workspaceId: scimTokens.workspaceId,
        name: scimTokens.name,
        tokenPrefix: scimTokens.tokenPrefix,
        revokedAt: scimTokens.revokedAt,
      })
      .from(scimTokens)
      .where(eq(scimTokens.id, id))
      .limit(1)
      .for('update');
    if (!locked || locked.workspaceId !== row.workspaceId || locked.revokedAt) return;
    const revokedAt = new Date();
    await tx.update(scimTokens).set({ revokedAt }).where(eq(scimTokens.id, id));
    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId: locked.workspaceId,
      action: 'scim_token.revoked',
      resourceType: 'scim_token',
      resourceId: locked.id,
      changes: { revokedAt: { from: null, to: revokedAt.toISOString() } },
      metadata: { name: locked.name, tokenPrefix: locked.tokenPrefix },
    });
  });
  return NextResponse.json({ ok: true });
}
