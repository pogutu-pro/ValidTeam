/**
 * Small recurrence engine for meetings (daily / weekly / monthly).
 *
 * Deliberately not RRULE: there is no recurrence dependency in the repo and
 * the product needs only these three frequencies. Occurrences are generated
 * on LOCAL calendar dates in the series' IANA zone and converted to UTC per
 * occurrence, so DST shifts never move the wall-clock start time.
 *
 * Semantics (match RFC 5545 where it matters):
 * - `count` is the total number of occurrences counted from the anchor.
 * - Monthly repeats on the anchor's day-of-month; months that lack that day
 *   are skipped (a 31st-of-month series does not fire in 30-day months).
 * - Weekly repeats on `byWeekday` (0=Sun..6=Sat), default the anchor's weekday;
 *   weeks are counted from the anchor's Sunday-start week.
 */
import { z } from 'zod';
import {
  addDays,
  dateKey,
  daysInMonth,
  isValidTimeZone,
  toLocalDateTime,
  weekdayOf,
  zonedToUtc,
} from './time';

export const MAX_OCCURRENCES_PER_SERIES = 366;
const MAX_ITERATIONS = 20_000;

export const recurrenceRuleSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(52).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    count: z.number().int().min(1).max(MAX_OCCURRENCES_PER_SERIES).optional(),
    /** Inclusive end instant (ISO 8601). */
    until: z.string().datetime({ offset: true }).optional(),
  })
  .refine((r) => r.freq === 'weekly' || !r.byWeekday, {
    message: 'byWeekday is only valid for weekly recurrence',
    path: ['byWeekday'],
  });

export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export interface Occurrence {
  /** Original local date (YYYY-MM-DD) in the series zone; stable idempotency key. */
  key: string;
  startAt: Date;
  endAt: Date;
}

export interface GenerateOptions {
  rule: RecurrenceRule;
  timeZone: string;
  anchorStartAt: Date;
  durationMinutes: number;
  /** Only return occurrences starting at/after this instant. Default: anchor. */
  from?: Date;
  /** Only return occurrences starting at/before this instant. Required. */
  through: Date;
}

export function generateOccurrences(opts: GenerateOptions): Occurrence[] {
  const { rule, timeZone, anchorStartAt, durationMinutes, through } = opts;
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid time zone: ${timeZone}`);

  const anchor = toLocalDateTime(anchorStartAt, timeZone);
  const anchorDate = { year: anchor.year, month: anchor.month, day: anchor.day };
  const untilMs = rule.until ? new Date(rule.until).getTime() : Infinity;
  const fromMs = (opts.from ?? anchorStartAt).getTime();
  const interval = rule.interval ?? 1;
  const maxCount = Math.min(rule.count ?? MAX_OCCURRENCES_PER_SERIES, MAX_OCCURRENCES_PER_SERIES);

  const out: Occurrence[] = [];
  let produced = 0;

  const emit = (date: { year: number; month: number; day: number }): 'continue' | 'stop' => {
    const startAt = zonedToUtc({ ...date, hour: anchor.hour, minute: anchor.minute }, timeZone);
    const startMs = startAt.getTime();
    if (startMs < anchorStartAt.getTime()) return 'continue'; // before the anchor (same-week days)
    if (startMs > untilMs || startMs > through.getTime()) return 'stop';
    produced += 1;
    if (startMs >= fromMs) {
      out.push({
        key: dateKey(date),
        startAt,
        endAt: new Date(startMs + durationMinutes * 60_000),
      });
    }
    return produced >= maxCount ? 'stop' : 'continue';
  };

  if (rule.freq === 'daily') {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (emit(addDays(anchorDate, i * interval)) === 'stop') break;
    }
  } else if (rule.freq === 'weekly') {
    const weekdays = [...new Set(rule.byWeekday ?? [weekdayOf(anchorDate)])].sort((a, b) => a - b);
    const weekStart = addDays(anchorDate, -weekdayOf(anchorDate)); // Sunday of anchor week
    outer: for (let w = 0; w < MAX_ITERATIONS; w++) {
      const base = addDays(weekStart, w * interval * 7);
      for (const wd of weekdays) {
        if (emit(addDays(base, wd)) === 'stop') break outer;
      }
    }
  } else {
    let monthsAhead = 0;
    for (let i = 0; i < MAX_ITERATIONS; i++, monthsAhead += interval) {
      const idx = anchor.year * 12 + (anchor.month - 1) + monthsAhead;
      const year = Math.floor(idx / 12);
      const month = (idx % 12) + 1;
      if (anchor.day > daysInMonth(year, month)) {
        // Skipped month: still stop once we are safely past the horizon.
        if (Date.UTC(year, month - 1, 1) > through.getTime() + 86_400_000) break;
        continue;
      }
      if (emit({ year, month, day: anchor.day }) === 'stop') break;
    }
  }
  return out;
}
