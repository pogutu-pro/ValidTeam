import type { MeetingStatus } from '@/lib/hooks/use-meetings';

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const m = Math.round(totalSeconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/**
 * Primary call-to-action blue for the meetings area (the product's global
 * primary is a different hue). Light mode uses white text; the lighter dark-mode
 * blue needs dark text to stay readable (WCAG AA).
 */
export const CTA_BLUE =
  'bg-accent-blue text-white hover:bg-accent-blue/90 focus-visible:ring-accent-blue dark:text-slate-950';

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

const SLUG = /^[A-Za-z0-9_-]{8,40}$/;

/**
 * Accepts a bare meeting code or a pasted link (https://host/meet/<code>?g=…)
 * and returns just the slug. The guest token, if any, is deliberately dropped:
 * members join with their account.
 */
export function extractMeetingSlug(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (SLUG.test(text)) return text;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('meet');
    const candidate = i >= 0 ? parts[i + 1] : undefined;
    return candidate && SLUG.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export interface DayGroup<T> {
  /** 'today' | 'tomorrow' | YYYY-MM-DD (local). */
  key: string;
  date: Date;
  items: T[];
}

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Group by LOCAL calendar day, preserving the input order inside each day. */
export function groupByDay<T extends { scheduledStartAt: string }>(
  items: T[],
  now: Date = new Date()
): DayGroup<T>[] {
  const today = startOfLocalDay(now).getTime();
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const d = new Date(item.scheduledStartAt);
    const day = startOfLocalDay(d);
    const diff = Math.round((day.getTime() - today) / 86_400_000);
    const key =
      diff === 0
        ? 'today'
        : diff === 1
          ? 'tomorrow'
          : `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const g = groups.get(key) ?? { key, date: day, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return [...groups.values()];
}
