/**
 * Slack channel-to-project routing table CRUD.
 *
 * GET    /api/integrations/slack/routes?organizationId=<id>
 *   List configured routes for the org's connected workspace.
 *
 * POST   /api/integrations/slack/routes
 *   Body: { organizationId, slackChannelId, slackChannelName?, projectId,
 *           defaultLabel?, emojiTrigger?, defaultPriority? }
 *   Upserts a route — the unique index on (org, team, channel) drives the
 *   "create-or-update" semantics so the UI never has to delete-then-recreate.
 *
 * DELETE /api/integrations/slack/routes?id=<routeId>&organizationId=<id>
 *   Removes a single route. Idempotent.
 *
 * NOTE: This is the minimal endpoint the roadmap calls out — a richer settings
 * UI is left as a follow-up. Access is aligned with integration settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db,
  and,
  auditLogs,
  eq,
  integrationConnections,
  ne,
  organizations,
  projects,
  slackChannelRoutes,
  sql,
} from '@validteam/db';
import { auth } from '@/auth';
import { hasPermission } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  organizationId: z.string().min(1),
  slackChannelId: z.string().regex(/^[A-Z0-9]{1,32}$/),
  slackChannelName: z.string().max(80).optional(),
  projectId: z.string().min(1),
  defaultLabel: z.string().max(80).optional(),
  emojiTrigger: z.string().max(64).optional(),
  defaultPriority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('medium'),
});

async function requireIntegrationSettingsPermission(
  request: NextRequest,
  organizationId: string
): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await hasPermission(organizationId, 'org:settings'))) {
    return NextResponse.json(
      { error: 'Managing integrations requires organization settings permission.' },
      { status: 403 }
    );
  }
  return { userId: session.user.id };
}

export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }
  const guard = await requireIntegrationSettingsPermission(request, organizationId);
  if (guard instanceof NextResponse) return guard;

  const [connection] = await db
    .select({ slackTeamId: integrationConnections.externalAccountId })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, 'slack')
      )
    )
    .limit(1);
  if (!connection?.slackTeamId) return NextResponse.json({ routes: [] });

  const rows = await db
    .select()
    .from(slackChannelRoutes)
    .where(
      and(
        eq(slackChannelRoutes.organizationId, organizationId),
        eq(slackChannelRoutes.slackTeamId, connection.slackTeamId)
      )
    );

  return NextResponse.json({ routes: rows });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const guard = await requireIntegrationSettingsPermission(request, parsed.data.organizationId);
  if (guard instanceof NextResponse) return guard;

  const result = await db.transaction(async (tx) => {
    // Share the same lock as OAuth connect/disconnect. A route can therefore
    // never be saved against a workspace while that workspace identity is
    // being replaced or removed.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`slack-organization:${parsed.data.organizationId}`}))`
    );

    const [[connection], [project]] = await Promise.all([
      tx
        .select({ slackTeamId: integrationConnections.externalAccountId })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, parsed.data.organizationId),
            eq(integrationConnections.provider, 'slack')
          )
        )
        .limit(1),
      tx
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(organizations, eq(organizations.id, projects.organizationId))
        .where(
          and(
            eq(projects.id, parsed.data.projectId),
            eq(projects.organizationId, parsed.data.organizationId),
            eq(projects.status, 'active'),
            ne(organizations.status, 'suspended')
          )
        )
        .limit(1),
    ]);
    if (!connection?.slackTeamId) return { error: 'slack_not_connected' as const };
    if (!project) return { error: 'project_not_found' as const };

    const [existing] = await tx
      .select({ id: slackChannelRoutes.id })
      .from(slackChannelRoutes)
      .where(
        and(
          eq(slackChannelRoutes.organizationId, parsed.data.organizationId),
          eq(slackChannelRoutes.slackTeamId, connection.slackTeamId),
          eq(slackChannelRoutes.slackChannelId, parsed.data.slackChannelId)
        )
      )
      .limit(1);

    const [saved] = await tx
      .insert(slackChannelRoutes)
      .values({
        organizationId: parsed.data.organizationId,
        slackTeamId: connection.slackTeamId,
        slackChannelId: parsed.data.slackChannelId,
        slackChannelName: parsed.data.slackChannelName ?? null,
        projectId: parsed.data.projectId,
        defaultLabel: parsed.data.defaultLabel ?? null,
        emojiTrigger: parsed.data.emojiTrigger ?? null,
        defaultPriority: parsed.data.defaultPriority,
      })
      .onConflictDoUpdate({
        target: [
          slackChannelRoutes.organizationId,
          slackChannelRoutes.slackTeamId,
          slackChannelRoutes.slackChannelId,
        ],
        set: {
          slackChannelName: parsed.data.slackChannelName ?? null,
          projectId: parsed.data.projectId,
          defaultLabel: parsed.data.defaultLabel ?? null,
          emojiTrigger: parsed.data.emojiTrigger ?? null,
          defaultPriority: parsed.data.defaultPriority,
          updatedAt: new Date(),
        },
      })
      .returning({ id: slackChannelRoutes.id });
    if (!saved) throw new Error('slack_route_save_failed');

    await tx.insert(auditLogs).values({
      userId: guard.userId,
      organizationId: parsed.data.organizationId,
      action: 'organization.updated',
      resourceType: 'slack_channel_route',
      resourceId: saved.id,
      projectId: parsed.data.projectId,
      metadata: {
        kind: existing ? 'slack_route_updated' : 'slack_route_created',
        slackTeamId: connection.slackTeamId,
        slackChannelId: parsed.data.slackChannelId,
      },
    });
    return { id: saved.id, created: !existing };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    id: result.id,
    created: result.created,
    updated: !result.created,
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('organizationId');
  const id = searchParams.get('id');
  if (!organizationId || !id) {
    return NextResponse.json({ error: 'organizationId and id are required' }, { status: 400 });
  }
  const guard = await requireIntegrationSettingsPermission(request, organizationId);
  if (guard instanceof NextResponse) return guard;

  const deleted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`slack-organization:${organizationId}`}))`
    );
    const [existing] = await tx
      .select({ id: slackChannelRoutes.id, projectId: slackChannelRoutes.projectId })
      .from(slackChannelRoutes)
      .where(
        and(eq(slackChannelRoutes.id, id), eq(slackChannelRoutes.organizationId, organizationId))
      )
      .limit(1);
    if (!existing) return false;

    await tx.delete(slackChannelRoutes).where(eq(slackChannelRoutes.id, existing.id));
    await tx.insert(auditLogs).values({
      userId: guard.userId,
      organizationId,
      action: 'organization.updated',
      resourceType: 'slack_channel_route',
      resourceId: existing.id,
      projectId: existing.projectId,
      metadata: { kind: 'slack_route_deleted' },
    });
    return true;
  });

  return NextResponse.json({ ok: true, deleted });
}
