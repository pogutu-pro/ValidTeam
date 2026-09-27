/**
 * POST /api/cron/agent-approval-effects
 *
 * Reconciles durable post-commit effects created by approved agent actions.
 * The worker leases rows, retries failures with backoff and reclaims abandoned
 * leases, so an application restart cannot strand a committed approval.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCronAuth } from '@/lib/agents/cron-auth';
import { processApprovalEffectOutbox } from '@/lib/agent-policy/approval-effects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const bodySchema = z.object({ limit: z.number().finite().int().min(1).optional() }).strict();

export async function POST(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  let limit = DEFAULT_BATCH_SIZE;
  const rawBody = await request.text();
  if (rawBody.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.errors },
        { status: 400 }
      );
    }
    limit = Math.min(MAX_BATCH_SIZE, parsed.data.limit ?? DEFAULT_BATCH_SIZE);
  }

  const summary = await processApprovalEffectOutbox({ limit });
  return NextResponse.json({ ok: true, ...summary });
}
