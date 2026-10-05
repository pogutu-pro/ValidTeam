import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { auditLogs, db, and, eq, sql } from '@validteam/db';
import { integrationConnections } from '@validteam/db/src/schema/integration-connections';
import { asTokenEnvelope, decryptToken } from '@/lib/integrations/token-crypto';
import { hasPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/integrations/slack?organizationId=<id>
 *
 * Revokes the org's Slack connection. We best-effort call `auth.revoke` on
 * Slack to invalidate the token upstream, then delete the row from
 * `integration_connections`. Token revocation failures are logged but do not
 * block deletion — the local row is the source of truth.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }

  if (!(await hasPermission(organizationId, 'org:settings'))) {
    return NextResponse.json(
      { error: 'Managing integrations requires organization settings permission.' },
      { status: 403 }
    );
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`slack-organization:${organizationId}`}))`
    );
    const [connection] = await tx
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, organizationId),
          eq(integrationConnections.provider, 'slack')
        )
      )
      .limit(1);
    if (!connection) return { alreadyDisconnected: true, revokeSucceeded: null };

    let revokeSucceeded: boolean | null = null;
    const envelope = asTokenEnvelope(connection.accessTokenEnc);
    if (envelope) {
      try {
        const token = decryptToken(envelope);
        const response = await fetch('https://slack.com/api/auth.revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${token}`,
          },
          body: new URLSearchParams({ token }).toString(),
          signal: AbortSignal.timeout(5_000),
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        revokeSucceeded = response.ok && payload?.ok === true;
      } catch (err) {
        revokeSucceeded = false;
        console.warn('Slack auth.revoke failed:', err);
      }
    }

    await tx.delete(integrationConnections).where(eq(integrationConnections.id, connection.id));
    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId,
      action: 'organization.updated',
      resourceType: 'integration_connection',
      resourceId: connection.id,
      metadata: {
        kind: 'slack_disconnected',
        workspaceId: connection.externalAccountId,
        revokeSucceeded,
      },
    });
    return { alreadyDisconnected: false, revokeSucceeded };
  });

  return NextResponse.json({ ok: true, ...result });
}
