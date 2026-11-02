import type { MeetingStatus } from '@/lib/hooks/use-meetings';
import { toLocalDateTime } from '@/lib/meetings/time';

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
  /** UTC-noon anchor for the group's calendar day; format with `timeZone: 'UTC'`. */
  date: Date;
  items: T[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The zone a meeting's wall-clock time is authored in. Falls back to the
 * runtime zone only for legacy rows that somehow lack one.
 */
export function meetingTimeZone(timeZone: string | undefined | null): string {
  return timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Calendar day of an instant in a zone (pure Intl, no offset arithmetic). */
function zoneDay(instant: Date, timeZone: string) {
  const local = toLocalDateTime(instant, timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

const dayStamp = (d: { year: number; month: number; day: number }) =>
  Date.UTC(d.year, d.month - 1, d.day);

/**
 * Group by calendar day **in each meeting's own zone**, so a meeting authored
 * at 8 PM never drifts into the previous/next day when the viewer's device is
 * in a different time zone. `date` is a UTC-noon anchor for that calendar day;
 * format it with `timeZone: 'UTC'`.
 */
export function groupByDay<T extends { scheduledStartAt: string; timezone?: string }>(
  items: T[],
  now: Date = new Date()
): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const timeZone = meetingTimeZone(item.timezone);
    const day = zoneDay(new Date(item.scheduledStartAt), timeZone);
    const diff = Math.round((dayStamp(day) - dayStamp(zoneDay(now, timeZone))) / 86_400_000);
    const key =
      diff === 0
        ? 'today'
        : diff === 1
          ? 'tomorrow'
          : `${day.year}-${pad2(day.month)}-${pad2(day.day)}`;
    const date = new Date(Date.UTC(day.year, day.month - 1, day.day, 12));
    const g = groups.get(key) ?? { key, date, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return [...groups.values()];
}
