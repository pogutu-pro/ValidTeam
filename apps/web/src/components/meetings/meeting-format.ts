import type { MeetingStatus } from '@/lib/hooks/use-meetings';

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const m = Math.round(totalSeconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v}%`;

/** Non-hosts can enter 10 minutes before the start (mirrors the server rule). */
export function canJoinNow(
  m: { status: MeetingStatus; scheduledStartAt: string; scheduledEndAt: string },
  isHost: boolean,
  now = Date.now()
): boolean {
  if (m.status === 'live') return true;
  if (m.status !== 'scheduled') return false;
  const start = new Date(m.scheduledStartAt).getTime();
  const end = new Date(m.scheduledEndAt).getTime();
  // Mirrors the server's join deadline (end + 30 min, minimum start + 60 min).
  const deadline = Math.max(end, start + 30 * 60_000) + 30 * 60_000;
  return now <= deadline && (isHost || now >= start - 10 * 60_000);
}

export const statusVariant = {
  scheduled: 'info',
  live: 'success',
  ended: 'muted',
  cancelled: 'destructive',
} as const satisfies Record<MeetingStatus, string>;
