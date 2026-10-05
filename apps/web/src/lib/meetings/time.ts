/**
 * Timezone helpers built on Intl (no dependency). Meetings store UTC instants
 * plus the IANA zone they were authored in; recurrence works on wall-clock
 * time in that zone so "10:00 every Monday" stays 10:00 across DST changes.
 */

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant in `timeZone`. */
export function toLocalDateTime(instant: Date, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

/** Offset (zone wall time minus UTC) at an instant, in ms. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(p.find((x) => x.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
  // Drop sub-second noise so the offset is a clean multiple of a minute.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant.
 * - Ambiguous time (clocks go back): the first occurrence wins.
 * - Non-existent time (clocks go forward): moved forward by the gap, i.e.
 *   02:30 on a spring-forward day becomes 03:30.
 */
export function zonedToUtc(local: LocalDateTime, timeZone: string): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const off1 = offsetMs(asUtc, timeZone);
  const guess1 = asUtc - off1;
  const off2 = offsetMs(guess1, timeZone);
  if (off1 === off2) return new Date(guess1);

  const guess2 = asUtc - off2;
  const back = toLocalDateTime(new Date(guess2), timeZone);
  const roundTrips =
    back.year === local.year &&
    back.month === local.month &&
    back.day === local.day &&
    back.hour === local.hour &&
    back.minute === local.minute;
  // Round-trips: unambiguous resolution. Otherwise the wall time falls in a
  // gap; guess1 lands after the gap, which is the "moved forward" behaviour.
  return new Date(roundTrips ? guess2 : guess1);
}

/** Calendar-day arithmetic that ignores time zones (pure Gregorian). */
export function addDays(date: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function dateKey(date: { year: number; month: number; day: number }): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(date.year, 4)}-${p(date.month)}-${p(date.day)}`;
}
