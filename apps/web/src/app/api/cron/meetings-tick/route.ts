/**
 * POST /api/cron/meetings-tick
 *
 * Meeting lifecycle tick — invoke about once a minute from the external
 * scheduler (same `x-cron-secret` contract as the other /api/cron routes).
 * Idempotent: repeated or overlapping calls never double-send or double-end.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/agents/cron-auth';
import { runMeetingTick } from '@/lib/meetings/tick';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const report = await runMeetingTick();
  return NextResponse.json({ ok: report.errors.length === 0, ...report });
}
