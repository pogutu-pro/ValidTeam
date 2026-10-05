/** @jest-environment node */
import { generateOccurrences, recurrenceRuleSchema } from '../recurrence';
import { isValidTimeZone, toLocalDateTime, zonedToUtc } from '../time';

const iso = (d: Date) => d.toISOString();

describe('time zone helpers', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Africa/Nairobi')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('converts wall time to UTC for a fixed-offset zone (EAT = UTC+3)', () => {
    expect(
      iso(zonedToUtc({ year: 2026, month: 10, day: 7, hour: 10, minute: 0 }, 'Africa/Nairobi'))
    ).toBe('2026-10-07T07:00:00.000Z');
  });

  it('resolves the spring-forward gap forward (02:30 -> 03:30 EDT)', () => {
    const d = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(iso(d)).toBe('2026-03-08T07:30:00.000Z');
    expect(toLocalDateTime(d, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
  });

  it('picks the first occurrence of an ambiguous fall-back time (01:30 EDT)', () => {
    const d = zonedToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      'America/New_York'
    );
    expect(iso(d)).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('generateOccurrences', () => {
  const base = { timeZone: 'America/New_York', durationMinutes: 60 };

  it('keeps wall-clock time across a DST change (weekly 10:00 New York)', () => {
    // Fri 2026-03-06 10:00 EST = 15:00Z; next Fri 03-13 is after DST => 14:00Z.
    const occ = generateOccurrences({
      ...base,
      rule: { freq: 'weekly', interval: 1 },
      anchorStartAt: new Date('2026-03-06T15:00:00Z'),
      through: new Date('2026-03-20T23:59:00Z'),
    });
    expect(occ.map((o) => iso(o.startAt))).toEqual([
      '2026-03-06T15:00:00.000Z',
      '2026-03-13T14:00:00.000Z',
      '2026-03-20T14:00:00.000Z',
    ]);
    expect(occ.map((o) => o.key)).toEqual(['2026-03-06', '2026-03-13', '2026-03-20']);
  });

  it('honours count and daily interval', () => {
    const occ = generateOccurrences({
      ...base,
      timeZone: 'UTC',
      rule: { freq: 'daily', interval: 2, count: 3 },
      anchorStartAt: new Date('2026-01-01T09:00:00Z'),
      through: new Date('2027-01-01T00:00:00Z'),
    });
    expect(occ.map((o) => o.key)).toEqual(['2026-01-01', '2026-01-03', '2026-01-05']);
  });

  it('weekly byWeekday never emits days before the anchor', () => {
    // Anchor Wed 2026-10-07; Mon/Wed/Fri => Wed, Fri, Mon, Wed...
    const occ = generateOccurrences({
      ...base,
      timeZone: 'UTC',
      rule: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], count: 4 },
      anchorStartAt: new Date('2026-10-07T09:00:00Z'),
      through: new Date('2026-12-31T00:00:00Z'),
    });
    expect(occ.map((o) => o.key)).toEqual(['2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14']);
  });

  it('monthly skips months without the anchor day (31st)', () => {
    const occ = generateOccurrences({
      ...base,
      timeZone: 'UTC',
      rule: { freq: 'monthly', interval: 1, count: 4 },
      anchorStartAt: new Date('2026-01-31T09:00:00Z'),
      through: new Date('2027-12-31T00:00:00Z'),
    });
    expect(occ.map((o) => o.key)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });

  it('respects until and the generation horizon, and is deterministic for repeated calls', () => {
    const args = {
      ...base,
      timeZone: 'UTC',
      rule: { freq: 'daily' as const, interval: 1, until: '2026-01-04T12:00:00Z' },
      anchorStartAt: new Date('2026-01-01T09:00:00Z'),
      through: new Date('2026-06-01T00:00:00Z'),
    };
    expect(generateOccurrences(args).map((o) => o.key)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(generateOccurrences(args)).toEqual(generateOccurrences(args));
  });

  it('`from` filters output without changing which occurrences count toward `count`', () => {
    const occ = generateOccurrences({
      ...base,
      timeZone: 'UTC',
      rule: { freq: 'daily', interval: 1, count: 5 },
      anchorStartAt: new Date('2026-01-01T09:00:00Z'),
      from: new Date('2026-01-04T00:00:00Z'),
      through: new Date('2026-06-01T00:00:00Z'),
    });
    expect(occ.map((o) => o.key)).toEqual(['2026-01-04', '2026-01-05']);
  });

  it('rejects byWeekday on non-weekly rules and bad counts', () => {
    expect(recurrenceRuleSchema.safeParse({ freq: 'daily', byWeekday: [1] }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({ freq: 'weekly', count: 100000 }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({ freq: 'weekly' }).success).toBe(true);
  });
});
