import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { auditLogs, db, webhooks } from '@validteam/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hasPermission } from '@/lib/auth/permissions';
import { UnsafeAgentProviderEndpointError } from '@/lib/agents/provider-endpoint';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/dispatcher';
import { validateWebhookEndpoint } from '@/lib/webhooks/url-policy';

export const dynamic = 'force-dynamic';

const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    url: z.string().trim().url().max(2048).optional(),
    events: z
      .array(z.enum(WEBHOOK_EVENTS))
      .min(1)
      .max(WEBHOOK_EVENTS.length)
      .refine((events) => new Set(events).size === events.length, 'duplicate_webhook_events')
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'webhook_update_empty',
  });

// PATCH /api/webhooks/[webhookId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { webhookId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const validatedData = updateWebhookSchema.parse(body);

    const [existingWebhook] = await db
      .select({
        id: webhooks.id,
        organizationId: webhooks.organizationId,
      })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId))
      .limit(1);

    if (!existingWebhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const canManage = await hasPermission(existingWebhook.organizationId, 'webhook:manage');
    if (!canManage) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const normalizedUrl = validatedData.url
      ? await validateWebhookEndpoint(validatedData.url)
      : undefined;

    const updatedWebhook = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, webhookId))
        .limit(1)
        .for('update');
      if (!current) return null;

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (validatedData.name !== undefined && validatedData.name !== current.name) {
        changes.name = { from: current.name, to: validatedData.name };
      }
      if (normalizedUrl !== undefined && normalizedUrl !== current.url) {
        changes.url = { from: 'configured', to: 'updated' };
      }
      if (
        validatedData.events !== undefined &&
        JSON.stringify(validatedData.events) !== JSON.stringify(current.events)
      ) {
        changes.events = { from: current.events, to: validatedData.events };
      }
      if (validatedData.isActive !== undefined && validatedData.isActive !== current.isActive) {
        changes.isActive = { from: current.isActive, to: validatedData.isActive };
      }

      if (Object.keys(changes).length === 0) return current;

      const [updated] = await tx
        .update(webhooks)
        .set({
          ...(validatedData.name !== undefined ? { name: validatedData.name } : {}),
          ...(normalizedUrl !== undefined ? { url: normalizedUrl } : {}),
          ...(validatedData.events !== undefined ? { events: validatedData.events } : {}),
          ...(validatedData.isActive !== undefined ? { isActive: validatedData.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(webhooks.id, webhookId))
        .returning();
      if (!updated) return null;

      await tx.insert(auditLogs).values({
        userId: session.user.id,
        organizationId: current.organizationId,
        action: 'webhook.updated',
        resourceType: 'webhook',
        resourceId: current.id,
        projectId: current.projectId ?? undefined,
        changes,
        metadata: { name: updated.name },
      });
      return updated;
    });

    if (!updatedWebhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json(updatedWebhook);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof UnsafeAgentProviderEndpointError) {
      return NextResponse.json({ error: 'webhook_url_unsafe' }, { status: 400 });
    }
    console.error('Error updating webhook:', error);
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
  }
}

// DELETE /api/webhooks/[webhookId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { webhookId } = await params;

    const [existingWebhook] = await db
      .select({
        id: webhooks.id,
        organizationId: webhooks.organizationId,
      })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId))
      .limit(1);

    if (!existingWebhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const canDelete = await hasPermission(existingWebhook.organizationId, 'webhook:delete');
    if (!canDelete) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const deleted = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, webhookId))
        .limit(1)
        .for('update');
      if (!current) return false;

      await tx.delete(webhooks).where(eq(webhooks.id, webhookId));
      await tx.insert(auditLogs).values({
        userId: session.user.id,
        organizationId: current.organizationId,
        action: 'webhook.deleted',
        resourceType: 'webhook',
        resourceId: current.id,
        projectId: current.projectId ?? undefined,
        changes: { deleted: { from: false, to: true } },
        metadata: { name: current.name },
      });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
