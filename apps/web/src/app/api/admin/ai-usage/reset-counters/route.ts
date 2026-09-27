/**
 * Manual / cron-driven counter reset for AI Cost Guard.
 *
 *   POST /api/admin/ai-usage/reset-counters
 *     body: { scope?: 'daily' | 'monthly' | 'both'; organizationId?: string }
 *
 * The runtime path already does lazy rollover inside
 * `checkAndReserveTokens`: any org with traffic rolls automatically at
 * the first call after the period boundary. This endpoint exists for
 * two cases that the lazy path can't cover:
 *
 *   1. External cron (e.g. Kubernetes CronJob hitting this URL at
 *      00:05 UTC) that wants to proactively zero counters for *all*
 *      orgs so the dashboard reflects "0 today" before any traffic.
 *   2. Manual ops intervention after a misconfiguration ("the daily
 *      limit was set to 10 by mistake; reset everyone now").
 *
 * Super-admin only. Authenticated via the standard session cookie OR
 * the X-Cron-Secret header set to CRON_SECRET (so a Kubernetes Job can
 * call it without a session).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { db, organizations, orgTokenBudgets, systemAuditLogs } from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  scope: z.enum(['daily', 'monthly', 'both']).optional().default('daily'),
  organizationId: z.string().min(1).optional(),
});

function startOfNextUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function secretsMatch(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function authorize(request: NextRequest) {
  // Cron secret path — kubernetes/external scheduler.
  const cronHeader = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  if (expected && cronHeader && secretsMatch(cronHeader, expected)) {
    return { userId: 'system:cron', actorKind: 'cron' as const };
  }

  const session = await auth();
  if (!session?.user?.id || !(await isSuperAdmin())) return null;
  return { userId: session.user.id, actorKind: 'admin' as const };
}

export async function POST(request: NextRequest) {
  const actor = await authorize(request);
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const dailyReset = body.scope === 'daily' || body.scope === 'both';
  const monthlyReset = body.scope === 'monthly' || body.scope === 'both';
  const nextResetsAt = startOfNextUtcDay();

  const updates: Record<string, unknown> = {
    periodResetsAt: nextResetsAt,
    updatedAt: new Date(),
  };
  if (dailyReset) {
    updates.dailyUsedTokens = 0;
    updates.dailyUsedCost = '0';
  }
  if (monthlyReset) {
    updates.monthlyUsedTokens = 0;
    updates.monthlyUsedCost = '0';
  }

  if (body.organizationId) {
    const result = await db.transaction(async (tx) => {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, body.organizationId!))
        .limit(1);
      if (!organization) return { kind: 'not_found' as const };

      await tx
        .insert(orgTokenBudgets)
        .values({
          organizationId: body.organizationId!,
          periodResetsAt: nextResetsAt,
          dailyUsedTokens: 0,
          dailyUsedCost: '0',
          monthlyUsedTokens: 0,
          monthlyUsedCost: '0',
        })
        .onConflictDoUpdate({
          target: orgTokenBudgets.organizationId,
          set: updates,
        });

      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: actor.userId,
        action: 'ai_usage.counters_reset',
        resourceType: 'organization',
        resourceId: body.organizationId!,
        organizationId: body.organizationId!,
        metadata: { scope: body.scope, actorKind: actor.actorKind, affectedOrganizations: 1 },
      });
      return { kind: 'reset' as const };
    });

    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      scope: body.scope,
      organizationId: body.organizationId,
    });
  }

  const affectedOrganizations = await db.transaction(async (tx) => {
    const rows = await tx
      .update(orgTokenBudgets)
      .set(updates)
      .returning({ organizationId: orgTokenBudgets.organizationId });
    await tx.insert(systemAuditLogs).values({
      id: createId(),
      userId: actor.userId,
      action: 'ai_usage.counters_reset',
      resourceType: 'ai_usage',
      resourceId: 'all_organizations',
      metadata: {
        scope: body.scope,
        actorKind: actor.actorKind,
        affectedOrganizations: rows.length,
      },
    });
    return rows.length;
  });

  return NextResponse.json({ ok: true, scope: body.scope, affectedOrganizations });
}
