import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, webhooks } from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { hasPermission } from '@/lib/auth/permissions';
import {
  WEBHOOK_EVENTS,
  deliverWebhookRequest,
  recordWebhookAttempt,
  signWebhookPayload,
  type WebhookEvent,
} from '@/lib/webhooks/dispatcher';

export const dynamic = 'force-dynamic';

// POST /api/webhooks/[webhookId]/test
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { webhookId } = await params;

    // Load full webhook record (including secret)
    const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const canManage = await hasPermission(webhook.organizationId, 'webhook:manage');
    if (!canManage) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Build the synthetic test payload
    const timestamp = new Date().toISOString();
    const payload = {
      event: 'webhook.test' as const,
      data: {
        kind: 'connectivity_check',
        timestamp,
      },
      webhookId: webhook.id,
    };

    const payloadString = JSON.stringify(payload);

    // Sign with HMAC-SHA256 using the same method as triggerWebhooks
    const signature = signWebhookPayload(payloadString, webhook.secret);
    const deliveryId = crypto.randomBytes(12).toString('hex');
    const attempt = await deliverWebhookRequest({
      webhookId: webhook.id,
      url: webhook.url,
      event: 'webhook.test',
      body: payloadString,
      signature,
      deliveryId,
    });

    // Pick an event enum value for the delivery record.
    // The webhook_deliveries.event column uses the restrictive webhookEventEnum
    // which does NOT include 'webhook.test', so we reuse the first subscribed
    // event (or fall back to 'issue.updated') while recording the real event
    // inside the payload itself.
    const subscribedEvents = Array.isArray(webhook.events) ? (webhook.events as string[]) : [];
    const firstConfiguredEvent = subscribedEvents.find((event): event is WebhookEvent =>
      WEBHOOK_EVENTS.includes(event as WebhookEvent)
    );
    const deliveryEvent = firstConfiguredEvent ?? 'issue.updated';
    const recorded = await recordWebhookAttempt({
      deliveryId,
      webhookId: webhook.id,
      event: deliveryEvent,
      payload,
      attempt,
      audit: {
        userId: session.user.id,
        organizationId: webhook.organizationId,
        projectId: webhook.projectId,
      },
    });

    if (!recorded) {
      return NextResponse.json(
        {
          error: 'webhook_test_outcome_untracked',
          delivery: {
            success: attempt.ok,
            statusCode: attempt.statusCode,
            durationMs: attempt.durationMs,
          },
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: attempt.ok,
      statusCode: attempt.statusCode,
      durationMs: attempt.durationMs,
      error: attempt.ok
        ? undefined
        : attempt.statusCode !== null
          ? 'webhook_test_http_error'
          : 'webhook_test_connection_failed',
    });
  } catch (error) {
    console.error('Error sending test webhook:', error);
    return NextResponse.json({ error: 'Failed to send test webhook' }, { status: 500 });
  }
}
