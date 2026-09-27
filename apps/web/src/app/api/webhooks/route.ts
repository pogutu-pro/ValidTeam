import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { auditLogs, db, organizations, projects, webhooks } from '@tasknebula/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'crypto';
import { hasPermission } from '@/lib/auth/permissions';
import { UnsafeAgentProviderEndpointError } from '@/lib/agents/provider-endpoint';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/dispatcher';
import { validateWebhookEndpoint } from '@/lib/webhooks/url-policy';

export const dynamic = 'force-dynamic';

const createWebhookSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().url().max(2048),
    organizationId: z.string().trim().min(1).max(128),
    projectId: z.string().trim().min(1).max(128).optional(),
    events: z
      .array(z.enum(WEBHOOK_EVENTS))
      .min(1)
      .max(WEBHOOK_EVENTS.length)
      .refine((events) => new Set(events).size === events.length, 'duplicate_webhook_events'),
  })
  .strict();

// Generate a webhook secret
function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// GET /api/webhooks?organizationId=xxx&projectId=xxx
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');
    const projectId = searchParams.get('projectId');

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    const canView = await hasPermission(organizationId, 'webhook:view');
    if (!canView) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Build query conditions
    const conditions = [eq(webhooks.organizationId, organizationId)];
    if (projectId) {
      conditions.push(eq(webhooks.projectId, projectId));
    } else {
      conditions.push(isNull(webhooks.projectId));
    }

    // Fetch webhooks
    const webhookList = await db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        url: webhooks.url,
        events: webhooks.events,
        isActive: webhooks.isActive,
        lastTriggeredAt: webhooks.lastTriggeredAt,
        successCount: webhooks.successCount,
        failureCount: webhooks.failureCount,
        createdAt: webhooks.createdAt,
        updatedAt: webhooks.updatedAt,
      })
      .from(webhooks)
      .where(and(...conditions));

    return NextResponse.json({ webhooks: webhookList });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

// POST /api/webhooks
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const validatedData = createWebhookSchema.parse(body);

    const canCreate = await hasPermission(validatedData.organizationId, 'webhook:create');
    if (!canCreate) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Resolve before persistence, then repeat the same policy at delivery time.
    const normalizedUrl = await validateWebhookEndpoint(validatedData.url);
    const secret = generateWebhookSecret();

    const newWebhook = await db.transaction(async (tx) => {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, validatedData.organizationId),
            ne(organizations.status, 'suspended')
          )
        )
        .limit(1)
        .for('share');
      if (!organization) return null;

      if (validatedData.projectId) {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, validatedData.projectId),
              eq(projects.organizationId, validatedData.organizationId)
            )
          )
          .limit(1)
          .for('share');
        if (!project) return null;
      }

      const [created] = await tx
        .insert(webhooks)
        .values({
          name: validatedData.name,
          url: normalizedUrl,
          secret,
          organizationId: validatedData.organizationId,
          projectId: validatedData.projectId,
          events: validatedData.events,
          createdBy: session.user.id,
        })
        .returning();
      if (!created) throw new Error('webhook_create_failed');

      await tx.insert(auditLogs).values({
        userId: session.user.id,
        organizationId: validatedData.organizationId,
        action: 'webhook.created',
        resourceType: 'webhook',
        resourceId: created.id,
        projectId: validatedData.projectId,
        metadata: {
          name: created.name,
          events: validatedData.events,
          projectScoped: Boolean(validatedData.projectId),
        },
      });
      return created;
    });

    if (!newWebhook) {
      return NextResponse.json({ error: 'webhook_scope_invalid' }, { status: 400 });
    }

    return NextResponse.json(
      {
        webhook: {
          ...newWebhook,
          secret, // Show secret only on creation
        },
      },
      { status: 201 }
    );
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
    console.error('Error creating webhook:', error);
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
  }
}
