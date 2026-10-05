/**
 * Admin AI cost-guard kill switch
 *
 *   POST /api/admin/ai-usage/kill-switch
 *     body: { organizationId: string; enabled: boolean; reason?: string }
 *
 * Super-admin only. Toggles the per-org emergency stop. When the kill
 * switch is on, every call through `checkAndReserveTokens()` is
 * rejected with `kill_switch`, regardless of remaining budget.
 *
 * Also resets/initialises the org's `org_token_budgets` row in case it
 * didn't exist yet so an admin can flip the kill switch *before* an
 * org's first LLM call.
 *
 * Each toggle is mirrored into `audit_logs` so security teams can audit
 * who hit the big red button.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { auditLogs, db, organizations, orgTokenBudgets, sql, systemAuditLogs } from '@validteam/db';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
  // Optional budget update bundled with the toggle for convenience.
  dailyTokenLimit: z.number().int().nonnegative().nullable().optional(),
  monthlyTokenLimit: z.number().int().nonnegative().nullable().optional(),
  dailyCostUsdLimit: z.number().nonnegative().nullable().optional(),
  monthlyCostUsdLimit: z.number().nonnegative().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = await isSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`validteam:ai-budget:${body.organizationId}`}))`
    );
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, body.organizationId))
      .limit(1);
    if (!org) return { kind: 'not_found' as const };

    const [existing] = await tx
      .select()
      .from(orgTokenBudgets)
      .where(eq(orgTokenBudgets.organizationId, body.organizationId))
      .limit(1)
      .for('update');

    const previousState = existing?.killSwitchEnabled ?? false;
    const nextBudget = {
      killSwitchEnabled: body.enabled,
      dailyTokenLimit:
        body.dailyTokenLimit === undefined
          ? (existing?.dailyTokenLimit ?? null)
          : body.dailyTokenLimit,
      monthlyTokenLimit:
        body.monthlyTokenLimit === undefined
          ? (existing?.monthlyTokenLimit ?? null)
          : body.monthlyTokenLimit,
      dailyCostUsdLimit:
        body.dailyCostUsdLimit === undefined
          ? (existing?.dailyCostUsdLimit ?? null)
          : body.dailyCostUsdLimit === null
            ? null
            : body.dailyCostUsdLimit.toFixed(4),
      monthlyCostUsdLimit:
        body.monthlyCostUsdLimit === undefined
          ? (existing?.monthlyCostUsdLimit ?? null)
          : body.monthlyCostUsdLimit === null
            ? null
            : body.monthlyCostUsdLimit.toFixed(4),
    };

    if (existing) {
      await tx
        .update(orgTokenBudgets)
        .set({ ...nextBudget, updatedAt: new Date() })
        .where(eq(orgTokenBudgets.id, existing.id));
    } else {
      await tx.insert(orgTokenBudgets).values({
        organizationId: body.organizationId,
        ...nextBudget,
      });
    }

    const metadata = {
      kind: 'ai_cost_guard_kill_switch',
      previous: previousState,
      next: body.enabled,
      reason: body.reason ?? null,
      limits: {
        dailyTokenLimit: nextBudget.dailyTokenLimit,
        monthlyTokenLimit: nextBudget.monthlyTokenLimit,
        dailyCostUsdLimit: nextBudget.dailyCostUsdLimit,
        monthlyCostUsdLimit: nextBudget.monthlyCostUsdLimit,
      },
    };

    await tx.insert(auditLogs).values({
      id: createId(),
      userId: session.user.id,
      organizationId: body.organizationId,
      action: 'agent.config_updated',
      resourceType: 'organization',
      resourceId: body.organizationId,
      changes: {
        killSwitchEnabled: { from: previousState, to: body.enabled },
      },
      metadata,
    });
    await tx.insert(systemAuditLogs).values({
      id: createId(),
      userId: session.user.id,
      action: 'ai_usage.kill_switch_updated',
      resourceType: 'organization',
      resourceId: body.organizationId,
      organizationId: body.organizationId,
      changes: {
        killSwitchEnabled: { from: previousState, to: body.enabled },
      },
      metadata,
    });

    return { kind: 'updated' as const };
  });

  if (result.kind === 'not_found') {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    organizationId: body.organizationId,
    killSwitchEnabled: body.enabled,
  });
}
