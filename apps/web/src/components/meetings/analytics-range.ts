export type RangePreset = 'today' | 'week' | 'month' | 'last30' | 'last90' | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Ranges are half-open [from, to) in the viewer's local calendar. */
export function resolveRange(
  preset: RangePreset,
  now: Date = new Date(),
  custom?: { from: string; to: string }
): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'week': {
      const monday = addDays(today, -((today.getDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 7) };
    }
    case 'month':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: new Date(today.getFullYear(), today.getMonth() + 1, 1),
      };
    case 'last30':
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case 'last90':
      return { from: addDays(today, -89), to: addDays(today, 1) };
    case 'custom': {
      const f = custom?.from ? new Date(`${custom.from}T00:00:00`) : addDays(today, -29);
      const t = custom?.to ? addDays(new Date(`${custom.to}T00:00:00`), 1) : addDays(today, 1);
      return { from: f, to: t };
    }
  }
}

/** Choose a bucket that keeps charts readable (<= ~31 points). */
export function bucketFor(range: DateRange): 'day' | 'week' | 'month' {
  const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
  return days <= 31 ? 'day' : days <= 200 ? 'week' : 'month';
}
