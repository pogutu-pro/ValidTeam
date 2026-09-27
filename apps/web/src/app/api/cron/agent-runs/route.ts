/** Reclaims pending or stale-leased durable project-agent graph runs. */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCronAuth } from '@/lib/agents/cron-auth';
import { processProjectAgentRunQueue } from '@/lib/agents/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;
const cronBodySchema = z.object({ limit: z.number().finite().int().min(1).optional() }).strict();

export async function POST(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  let limit = DEFAULT_BATCH_SIZE;
  const rawBody = await request.text();
  if (rawBody.trim()) {
    let value: unknown;
    try {
      value = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
    const parsed = cronBodySchema.safeParse(value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.errors },
        { status: 400 }
      );
    }
    limit = Math.min(MAX_BATCH_SIZE, parsed.data.limit ?? DEFAULT_BATCH_SIZE);
  }

  const { summary } = await processProjectAgentRunQueue({ limit });
  return NextResponse.json({ ok: true, ...summary });
}
