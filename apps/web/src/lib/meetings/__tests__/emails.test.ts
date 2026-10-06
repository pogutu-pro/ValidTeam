/** @jest-environment node */
import { buildIcs, escapeIcsText, googleCalendarUrl, rruleFor } from '../ics';
import {
  buildInvitationEmail,
  buildNoShowEmail,
  buildReminderEmail,
  buildSummaryEmail,
  escapeHtml,
  formatDuration,
  formatMeetingRange,
  type MeetingEmailCtx,
  type SummaryData,
} from '../emails';

const ctx = (over: Partial<MeetingEmailCtx> = {}): MeetingEmailCtx => ({
  title: 'Product Planning',
  hostName: 'Paul',
  organizationName: 'Acme',
  start: new Date('2026-10-07T07:00:00Z'),
  end: new Date('2026-10-07T08:12:00Z'),
  timeZone: 'Africa/Nairobi',
  joinUrl: 'https://app.test/meet/abc',
  isGuest: false,
  isSeries: false,
  ...over,
});

describe('formatting', () => {
  it('renders the range in the recipient zone', () => {
    expect(formatMeetingRange(ctx().start, ctx().end, 'Africa/Nairobi')).toEqual({
      date: 'Wednesday, October 7, 2026',
      time: expect.stringContaining('10:00 AM'),
    });
    expect(formatMeetingRange(ctx().start, ctx().end, 'America/Los_Angeles').time).toContain(
      '12:00 AM'
    );
  });
  it('formats durations', () => {
    expect(formatDuration(72 * 60)).toBe('1h 12m');
    expect(formatDuration(58 * 60)).toBe('58m');
  });
});

describe('ics', () => {
  it('escapes text and folds long lines', () => {
    expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd');
    const ics = buildIcs({
      uid: 'u1',
      title: 'x'.repeat(200),
      url: 'https://app.test/meet/abc',
      start: ctx().start,
      end: ctx().end,
      organizerName: 'Paul',
    });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics).toContain('DTSTART:20261007T070000Z');
    expect(ics).toContain('METHOD:REQUEST');
  });
  it('series use TZID wall-clock time and an RRULE', () => {
    const ics = buildIcs({
      uid: 's1',
      title: 'Standup',
      url: 'https://app.test/meet/abc',
      start: new Date('2026-10-07T07:00:00Z'),
      end: new Date('2026-10-07T07:15:00Z'),
      organizerName: 'Paul',
      recurrence: { rule: { freq: 'weekly', interval: 1, count: 4 }, timezone: 'Africa/Nairobi' },
    });
    expect(ics).toContain('DTSTART;TZID=Africa/Nairobi:20261007T100000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;COUNT=4');
  });
  it('builds rrule variants and a Google Calendar link', () => {
    expect(rruleFor({ freq: 'monthly', interval: 2 }, 'UTC', ctx().start)).toBe(
      'FREQ=MONTHLY;INTERVAL=2'
    );
    expect(
      rruleFor({ freq: 'weekly', interval: 1, byWeekday: [5, 1] }, 'UTC', ctx().start)
    ).toContain('BYDAY=MO,FR');
    expect(
      googleCalendarUrl({ title: 'A&B', url: 'https://x', start: ctx().start, end: ctx().end })
    ).toContain('dates=20261007T070000Z%2F20261007T081200Z');
  });
});

describe('email templates', () => {
  it('escapes user-controlled values everywhere', () => {
    const evil = ctx({ title: '<img src=x onerror=alert(1)>', hostName: '"><script>x</script>' });
    for (const e of [
      buildInvitationEmail(evil, 'https://app.test'),
      buildReminderEmail(evil, 'https://app.test'),
      buildNoShowEmail(evil, 'https://app.test'),
    ]) {
      expect(e.html).not.toContain('<script>');
      expect(e.html).not.toContain('<img src=x');
    }
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('resolves every merge token', () => {
    for (const e of [
      buildInvitationEmail(ctx(), 'https://app.test'),
      buildReminderEmail(ctx(), 'https://app.test'),
      buildNoShowEmail(ctx(), 'https://app.test'),
    ]) {
      expect(e.html).not.toMatch(/\{\{/);
      expect(e.text).not.toMatch(/\{\{/);
      expect(e.html).toContain('Join meeting');
      expect(e.html).toContain('https://app.test/meet/abc');
    }
  });
  it('guest invitation explains no account is needed and never claims org membership', () => {
    const e = buildInvitationEmail(ctx({ isGuest: true }), 'https://app.test');
    expect(e.html).toContain('do not need a ValidTeam account');
    expect(e.html).not.toContain('member of Acme');
    expect(e.html).toContain('invited you to this meeting');
    expect(e.html).not.toContain('Manage notifications');
  });
  it('no-show wording matches the brief', () => {
    const e = buildNoShowEmail(ctx(), 'https://app.test');
    expect(e.text).toContain('which started 30 minutes ago. The meeting may still be active.');
  });

  const summary = (over: Partial<SummaryData> = {}): SummaryData => ({
    durationSeconds: 72 * 60,
    invited: 8,
    attended: 6,
    noShows: 2,
    peak: 6,
    avgAttendancePct: 84,
    lateArrivals: 2,
    earlyDepartures: 1,
    you: {
      noShow: false,
      firstJoinedAt: new Date('2026-10-07T07:04:00Z'),
      lastLeftAt: new Date('2026-10-07T08:10:00Z'),
      attendedSeconds: 66 * 60,
      attendancePct: 92,
    },
    roster: [
      { name: 'Joseph', attended: true, attendedSeconds: 72 * 60 },
      { name: 'Brian', attended: false, attendedSeconds: null },
    ],
    analyticsUrl: 'https://app.test/meetings/abc',
    ...over,
  });
  it('member summary includes the named overview and analytics link', () => {
    const e = buildSummaryEmail(ctx(), summary(), 'https://app.test');
    expect(e.html).toContain('Joseph');
    expect(e.html).toContain('Did not attend');
    expect(e.html).toContain('View meeting analytics');
    expect(e.html).toContain('1h 06m');
    expect(e.html).toContain('92%');
  });
  it('guest summary omits other people and the analytics link', () => {
    const e = buildSummaryEmail(
      ctx({ isGuest: true }),
      summary({ roster: null, analyticsUrl: null }),
      'https://app.test'
    );
    expect(e.html).not.toContain('Joseph');
    expect(e.html).not.toContain('Attendance overview');
    expect(e.html).not.toContain('View meeting analytics');
    expect(e.html).toContain('6 attended');
  });
  it('no-shows get a plain statement instead of invented times', () => {
    const e = buildSummaryEmail(
      ctx(),
      summary({
        you: {
          noShow: true,
          firstJoinedAt: null,
          lastLeftAt: null,
          attendedSeconds: null,
          attendancePct: null,
        },
      }),
      'https://app.test'
    );
    expect(e.html).toContain('You did not attend this meeting.');
  });
});
