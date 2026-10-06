import { bucketFor, resolveRange } from '../analytics-range';
import { canJoinNow, formatDuration, pct } from '../meeting-format';
import { parseGuestEmails, zonedInputToIso } from '../schedule-validation';

describe('parseGuestEmails', () => {
  it('splits on commas, semicolons and whitespace, lower-cases and de-duplicates', () => {
    const r = parseGuestEmails(
      'John@Example.com, jane@example.com;\nJOHN@example.com  client@co.io'
    );
    expect(r.valid).toEqual(['john@example.com', 'jane@example.com', 'client@co.io']);
    expect(r.invalid).toEqual([]);
  });
  it('reports invalid addresses', () => {
    expect(parseGuestEmails('ok@x.io, nope, a@b').invalid).toEqual(['nope', 'a@b']);
  });
});

describe('zonedInputToIso', () => {
  it('converts wall time in the chosen zone, not the browser zone', () => {
    expect(zonedInputToIso('2026-10-07', '10:00', 'Africa/Nairobi')).toBe(
      '2026-10-07T07:00:00.000Z'
    );
    expect(zonedInputToIso('2026-10-07', '10:00', 'America/Los_Angeles')).toBe(
      '2026-10-07T17:00:00.000Z'
    );
  });
  it('handles the DST gap and rejects bad input', () => {
    expect(zonedInputToIso('2026-03-08', '02:30', 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z'
    );
    expect(zonedInputToIso('nope', '10:00', 'UTC')).toBeNull();
    expect(zonedInputToIso('2026-10-07', '10:00', 'Not/AZone')).toBeNull();
  });
});

describe('analytics ranges', () => {
  const now = new Date(2026, 9, 7, 15, 30); // Wed 7 Oct 2026 local
  it('resolves half-open local-calendar ranges', () => {
    const today = resolveRange('today', now);
    expect(today.to.getTime() - today.from.getTime()).toBe(86_400_000);
    const week = resolveRange('week', now);
    expect(week.from.getDay()).toBe(1); // Monday
    expect(Math.round((week.to.getTime() - week.from.getTime()) / 86_400_000)).toBe(7);
    const month = resolveRange('month', now);
    expect(month.from.getDate()).toBe(1);
    expect(month.to.getMonth()).toBe(10);
    const last30 = resolveRange('last30', now);
    expect(Math.round((last30.to.getTime() - last30.from.getTime()) / 86_400_000)).toBe(30);
  });
  it('custom range includes the end day and falls back sensibly', () => {
    const r = resolveRange('custom', now, { from: '2026-10-01', to: '2026-10-03' });
    expect(r.from.getDate()).toBe(1);
    expect(r.to.getDate()).toBe(4);
    expect(
      resolveRange('custom', now, { from: '', to: '' }).to >
        resolveRange('custom', now, { from: '', to: '' }).from
    ).toBe(true);
  });
  it('picks a readable bucket', () => {
    expect(bucketFor(resolveRange('last30', now))).toBe('day');
    expect(bucketFor(resolveRange('last90', now))).toBe('week');
    expect(bucketFor({ from: new Date(2025, 0, 1), to: new Date(2026, 0, 1) })).toBe('month');
  });
});

describe('formatting and join window', () => {
  it('formats durations and percentages with unavailable values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(66 * 60)).toBe('1h 06m');
    expect(pct(null)).toBe('—');
    expect(pct(92)).toBe('92%');
  });
  it('mirrors the server join rules', () => {
    const base = Date.now();
    const m = (offsetMin: number, status: 'scheduled' | 'live' | 'ended' = 'scheduled') => ({
      status,
      scheduledStartAt: new Date(base + offsetMin * 60_000).toISOString(),
      scheduledEndAt: new Date(base + (offsetMin + 60) * 60_000).toISOString(),
    });
    expect(canJoinNow(m(120), false)).toBe(false); // too early for participants
    expect(canJoinNow(m(120), true)).toBe(true); // host may start any time
    expect(canJoinNow(m(5), false)).toBe(true); // within the 10 minute window
    expect(canJoinNow(m(-500), true)).toBe(false); // window long passed
    expect(canJoinNow(m(-500, 'live'), false)).toBe(true);
    expect(canJoinNow(m(0, 'ended'), true)).toBe(false);
  });
});

import { extractMeetingSlug, groupByDay } from '../meeting-format';

describe('extractMeetingSlug', () => {
  it('accepts bare codes and links, drops guest tokens, rejects junk', () => {
    expect(extractMeetingSlug('  abcdefgh1234  ')).toBe('abcdefgh1234');
    expect(extractMeetingSlug('https://app.example.com/meet/abcdefgh1234?g=tok')).toBe(
      'abcdefgh1234'
    );
    expect(extractMeetingSlug('app.example.com/meet/abcdefgh1234')).toBe('abcdefgh1234');
    expect(extractMeetingSlug('https://app.example.com/other/abcdefgh1234')).toBeNull();
    expect(extractMeetingSlug('short')).toBeNull();
    expect(extractMeetingSlug('has spaces in it')).toBeNull();
    expect(extractMeetingSlug('')).toBeNull();
  });
});

describe('groupByDay', () => {
  it('groups by local calendar day with Today/Tomorrow keys, preserving order', () => {
    const now = new Date(2026, 9, 7, 9, 0);
    const at = (d: number, h: number) => new Date(2026, 9, 7 + d, h, 0).toISOString();
    const groups = groupByDay(
      [
        { id: 'a', scheduledStartAt: at(0, 10) },
        { id: 'b', scheduledStartAt: at(0, 15) },
        { id: 'c', scheduledStartAt: at(1, 9) },
        { id: 'd', scheduledStartAt: at(5, 9) },
      ],
      now
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'tomorrow', '2026-10-12']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
