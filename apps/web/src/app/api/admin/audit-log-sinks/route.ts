/**
 * Audit log sinks — admin endpoint.
 *
 * GET    /api/admin/audit-log-sinks?organizationId=...
 *   List configured sinks for the workspace. Requires org:settings.
 *
 * POST   /api/admin/audit-log-sinks
 *   Create a new sink. Body:
 *     { organizationId, type, name, config, enabled? }
 *
 * The signing secret is generated server-side and returned ONCE in the POST
 * response. It is not echoed back on subsequent reads.
 *
 * Individual sink mutation / delete / test endpoints live under
 * `[sinkId]/route.ts` and `[sinkId]/test/route.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { auth } from '@/auth';
import { hasPermission } from '@/lib/auth/permissions';
import { auditLogs, auditLogSinks, db, eq } from '@validteam/db';
import { AUDIT_SINK_TYPES, redactSinkConfig, validateSinkConfig } from './utils';

export const dynamic = 'force-dynamic';

const sinkTypeEnum = z.enum(AUDIT_SINK_TYPES);

const createSinkSchema = z.object({
  organizationId: z.string().min(1),
  type: sinkTypeEnum,
  name: z.string().min(1).max(120),
  config: z.unknown(),
  enabled: z.boolean().optional().default(true),
});

function generateSigningSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }
  const canView = await hasPermission(organizationId, 'org:settings');
  if (!canView) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const rows = await db
    .select({
      id: auditLogSinks.id,
      type: auditLogSinks.type,
      name: auditLogSinks.name,
      config: auditLogSinks.config,
      enabled: auditLogSinks.enabled,
      lastDeliveryAt: auditLogSinks.lastDeliveryAt,
      lastError: auditLogSinks.lastError,
      successCount: auditLogSinks.successCount,
      failureCount: auditLogSinks.failureCount,
      createdAt: auditLogSinks.createdAt,
      updatedAt: auditLogSinks.updatedAt,
    })
    .from(auditLogSinks)
    .where(eq(auditLogSinks.workspaceId, organizationId));

  // Strip secrets from configs before returning.
  const sanitized = rows.map((row) => ({
    ...row,
    config: redactSinkConfig(row.type as string, row.config as Record<string, unknown>),
  }));
  return NextResponse.json({ sinks: sanitized });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = createSinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const canManage = await hasPermission(data.organizationId, 'org:settings');
  if (!canManage) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const parsedConfig = validateSinkConfig(data.type, data.config);
  if (!parsedConfig.success) {
    return NextResponse.json(
      { error: 'audit_sink_config_invalid', details: parsedConfig.error.errors },
      { status: 400 }
    );
  }
  const signingSecret = generateSigningSecret();
  const created = await db.transaction(async (tx) => {
    const [sink] = await tx
      .insert(auditLogSinks)
      .values({
        workspaceId: data.organizationId,
        type: data.type,
        name: data.name,
        config: parsedConfig.data,
        enabled: data.enabled,
        signingSecret,
        createdBy: session.user.id,
      })
      .returning();
    if (!sink) throw new Error('audit_sink_create_failed');

    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId: data.organizationId,
      action: 'organization.updated',
      resourceType: 'audit_log_sink',
      resourceId: sink.id,
      changes: { enabled: { from: null, to: sink.enabled } },
      metadata: { kind: 'audit_log_sink_created', type: sink.type, name: sink.name },
    });
    return sink;
  });
  return NextResponse.json(
    {
      sink: {
        ...created,
        config: redactSinkConfig(created.type, parsedConfig.data),
        // Show the signing secret exactly once.
        signingSecret,
      },
    },
    { status: 201 }
  );
}
