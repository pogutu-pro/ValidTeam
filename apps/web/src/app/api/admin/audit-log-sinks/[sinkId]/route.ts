/**
 * Audit log sink — single-row endpoint.
 *
 * PATCH  /api/admin/audit-log-sinks/:sinkId
 *   Partial update: name, config, enabled.
 *
 * DELETE /api/admin/audit-log-sinks/:sinkId
 *   Remove the sink.
 *
 * Both require `org:settings` on the owning workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { hasPermission } from '@/lib/auth/permissions';
import { auditLogs, auditLogSinks, db, eq } from '@tasknebula/db';
import { redactSinkConfig, validateSinkConfig } from '../utils';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    config: z.unknown().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'audit_sink_update_empty',
  });

async function loadSink(sinkId: string) {
  const [row] = await db.select().from(auditLogSinks).where(eq(auditLogSinks.id, sinkId)).limit(1);
  return row ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sinkId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sinkId } = await params;
  const sink = await loadSink(sinkId);
  if (!sink) {
    return NextResponse.json({ error: 'Sink not found' }, { status: 404 });
  }
  const canManage = await hasPermission(sink.workspaceId, 'org:settings');
  if (!canManage) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const parsedConfig =
    data.config === undefined ? null : validateSinkConfig(sink.type, data.config);
  if (parsedConfig && !parsedConfig.success) {
    return NextResponse.json(
      { error: 'audit_sink_config_invalid', details: parsedConfig.error.errors },
      { status: 400 }
    );
  }

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(auditLogSinks)
      .where(eq(auditLogSinks.id, sinkId))
      .limit(1)
      .for('update');
    if (!current) return null;

    const [next] = await tx
      .update(auditLogSinks)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(parsedConfig?.success ? { config: parsedConfig.data } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(auditLogSinks.id, sinkId))
      .returning();
    if (!next) return null;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (data.name !== undefined && data.name !== current.name) {
      changes.name = { from: current.name, to: data.name };
    }
    if (data.enabled !== undefined && data.enabled !== current.enabled) {
      changes.enabled = { from: current.enabled, to: data.enabled };
    }
    if (parsedConfig?.success) {
      changes.config = { from: 'configured', to: 'updated' };
    }
    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId: current.workspaceId,
      action: 'organization.updated',
      resourceType: 'audit_log_sink',
      resourceId: current.id,
      changes,
      metadata: { kind: 'audit_log_sink_updated', type: current.type, name: next.name },
    });
    return next;
  });
  if (!updated) {
    return NextResponse.json({ error: 'Sink not found' }, { status: 404 });
  }
  return NextResponse.json({
    sink: {
      ...updated,
      config: redactSinkConfig(
        updated.type as string,
        (updated.config as Record<string, unknown>) ?? {}
      ),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sinkId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { sinkId } = await params;
  const sink = await loadSink(sinkId);
  if (!sink) {
    return NextResponse.json({ error: 'Sink not found' }, { status: 404 });
  }
  const canManage = await hasPermission(sink.workspaceId, 'org:settings');
  if (!canManage) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const deleted = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(auditLogSinks)
      .where(eq(auditLogSinks.id, sinkId))
      .limit(1)
      .for('update');
    if (!current) return false;

    await tx.delete(auditLogSinks).where(eq(auditLogSinks.id, sinkId));
    await tx.insert(auditLogs).values({
      userId: session.user.id,
      organizationId: current.workspaceId,
      action: 'organization.updated',
      resourceType: 'audit_log_sink',
      resourceId: current.id,
      changes: { deleted: { from: false, to: true } },
      metadata: { kind: 'audit_log_sink_deleted', type: current.type, name: current.name },
    });
    return true;
  });
  if (!deleted) {
    return NextResponse.json({ error: 'Sink not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
