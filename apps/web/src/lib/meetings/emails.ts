/**
 * Meeting email builders. They compose the shared ValidTeam email shell
 * (packages/db email-layout) so meeting mail matches every other ValidTeam
 * email. All interpolated values are HTML-escaped: titles, names and guest
 * names are user-controlled.
 */
import {
  EMAIL_COLORS,
  metaRow,
  metaTable,
  paragraph,
  renderShell,
  sectionHeading,
  statGrid,
  textFooter,
} from '@validteam/db';

export type MeetingEmailKind = 'invitation' | 'reminder_30m' | 'no_show_30m' | 'summary';

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const strong = (s: string) =>
  `<strong style="color:${EMAIL_COLORS.heading};">${escapeHtml(s)}</strong>`;

export function formatMeetingRange(
  start: Date,
  end: Date,
  timeZone: string
): { date: string; time: string } {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(start);
  const t = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const t2 = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return { date, time: `${t2.format(start)} – ${t.format(end)}` };
}

export function formatClock(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    d
  );
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export interface MeetingEmailCtx {
  title: string;
  hostName: string;
  organizationName: string;
  start: Date;
  end: Date;
  timeZone: string;
  joinUrl: string;
  isGuest: boolean;
  isSeries: boolean;
  recipientName?: string | null;
  calendarUrl?: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Resolve the shell's merge tokens; the guest footer must not claim org membership. */
function finalize(html: string, ctx: MeetingEmailCtx, appUrl: string): string {
  let out = html;
  if (ctx.isGuest) {
    out = out.replace(
      "You're receiving this because you're a member of {{organizationName}}.",
      `You're receiving this because ${escapeHtml(ctx.hostName)} invited you to this meeting.`
    );
    out = out.replace(
      /<a href="\{\{unsubscribeUrl\}\}"[^>]*>Manage notifications<\/a>\s*&nbsp;&middot;&nbsp;\s*/,
      ''
    );
  }
  return out
    .replaceAll('{{unsubscribeUrl}}', `${appUrl}/settings?tab=notifications`)
    .replaceAll('{{appUrl}}', appUrl)
    .replaceAll('{{organizationName}}', escapeHtml(ctx.organizationName));
}

const textTail = (ctx: MeetingEmailCtx, appUrl: string) =>
  textFooter()
    .replaceAll('{{unsubscribeUrl}}', `${appUrl}/settings?tab=notifications`)
    .replaceAll('{{organizationName}}', ctx.organizationName);

function whenRows(ctx: MeetingEmailCtx): string {
  const { date, time } = formatMeetingRange(ctx.start, ctx.end, ctx.timeZone);
  return metaTable(
    metaRow('When', `${strong(date)}<br/>${escapeHtml(time)}`) +
      metaRow('Host', escapeHtml(ctx.hostName)) +
      metaRow(
        'Link',
        `<a href="${escapeHtml(ctx.joinUrl)}" style="color:${EMAIL_COLORS.brand};word-break:break-all;">${escapeHtml(ctx.joinUrl)}</a>`
      )
  );
}

function whenText(ctx: MeetingEmailCtx): string {
  const { date, time } = formatMeetingRange(ctx.start, ctx.end, ctx.timeZone);
  return `${date}\n${time}\nHost: ${ctx.hostName}\nJoin: ${ctx.joinUrl}`;
}

export function buildInvitationEmail(ctx: MeetingEmailCtx, appUrl: string): BuiltEmail {
  const { date, time } = formatMeetingRange(ctx.start, ctx.end, ctx.timeZone);
  const guestNote = ctx.isGuest
    ? paragraph(
        'You do not need a ValidTeam account. Open the link, enter your name and join from your browser. This link is personal to you — please do not forward it.',
        { spacingTop: 14 }
      )
    : '';
  const recurNote = ctx.isSeries
    ? paragraph(
        'This is a recurring meeting; later occurrences are in the attached calendar event.',
        { muted: true, spacingTop: 10 }
      )
    : '';
  const cal = ctx.calendarUrl
    ? paragraph(
        `<a href="${escapeHtml(ctx.calendarUrl)}" style="color:${EMAIL_COLORS.brand};">Add to Google Calendar</a> &middot; the invitation also includes a calendar file (.ics).`,
        { muted: true, spacingTop: 12 }
      )
    : '';
  const html = renderShell({
    preheader: `${escapeHtml(ctx.hostName)} invited you to ${escapeHtml(ctx.title)} on ${escapeHtml(date)}.`,
    kicker: 'MEETING INVITATION',
    heading: escapeHtml(ctx.title),
    body:
      paragraph(`${strong(ctx.hostName)} invited you to a meeting.`) +
      whenRows(ctx) +
      guestNote +
      recurNote +
      cal,
    ctaLabel: 'Join meeting',
    ctaUrl: escapeHtml(ctx.joinUrl),
  });
  return {
    subject: `Invitation: ${ctx.title} — ${date}, ${time}`,
    html: finalize(html, ctx, appUrl),
    text: `${ctx.hostName} invited you to ${ctx.title}.\n\n${whenText(ctx)}${ctx.isGuest ? '\n\nNo ValidTeam account is needed. Open the link, enter your name and join.' : ''}${textTail(ctx, appUrl)}`,
  };
}

export function buildReminderEmail(ctx: MeetingEmailCtx, appUrl: string): BuiltEmail {
  const html = renderShell({
    preheader: `${escapeHtml(ctx.title)} starts in 30 minutes.`,
    kicker: 'STARTS IN 30 MINUTES',
    heading: escapeHtml(ctx.title),
    body: paragraph(`Your meeting with ${strong(ctx.hostName)} starts soon.`) + whenRows(ctx),
    ctaLabel: 'Join meeting',
    ctaUrl: escapeHtml(ctx.joinUrl),
  });
  return {
    subject: `Starting in 30 minutes: ${ctx.title}`,
    html: finalize(html, ctx, appUrl),
    text: `${ctx.title} starts in 30 minutes.\n\n${whenText(ctx)}${textTail(ctx, appUrl)}`,
  };
}

export function buildNoShowEmail(ctx: MeetingEmailCtx, appUrl: string): BuiltEmail {
  const html = renderShell({
    preheader: `${escapeHtml(ctx.title)} started 30 minutes ago and may still be active.`,
    kicker: 'MEETING IN PROGRESS',
    heading: escapeHtml(ctx.title),
    body:
      paragraph(
        `You were invited to ${strong(ctx.title)}, which started 30 minutes ago. The meeting may still be active.`
      ) + whenRows(ctx),
    ctaLabel: 'Join meeting',
    ctaUrl: escapeHtml(ctx.joinUrl),
  });
  return {
    subject: `You were invited to ${ctx.title}, which started 30 minutes ago`,
    html: finalize(html, ctx, appUrl),
    text: `You were invited to ${ctx.title}, which started 30 minutes ago. The meeting may still be active.\n\n${whenText(ctx)}${textTail(ctx, appUrl)}`,
  };
}

export interface SummaryData {
  durationSeconds: number | null;
  invited: number;
  attended: number;
  noShows: number;
  peak: number;
  avgAttendancePct: number | null;
  lateArrivals: number;
  earlyDepartures: number;
  you: {
    noShow: boolean;
    firstJoinedAt: Date | null;
    lastLeftAt: Date | null;
    attendedSeconds: number | null;
    attendancePct: number | null;
  };
  /** Only for internal members — guests never receive other people's attendance. */
  roster: Array<{ name: string; attended: boolean; attendedSeconds: number | null }> | null;
  analyticsUrl: string | null;
}

export function buildSummaryEmail(
  ctx: MeetingEmailCtx,
  s: SummaryData,
  appUrl: string
): BuiltEmail {
  const { date, time } = formatMeetingRange(ctx.start, ctx.end, ctx.timeZone);
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  const you = s.you.noShow
    ? paragraph('You did not attend this meeting.')
    : metaTable(
        metaRow(
          'Joined',
          s.you.firstJoinedAt ? formatClock(s.you.firstJoinedAt, ctx.timeZone) : '—'
        ) +
          metaRow('Left', s.you.lastLeftAt ? formatClock(s.you.lastLeftAt, ctx.timeZone) : '—') +
          metaRow(
            'Time attended',
            s.you.attendedSeconds === null ? '—' : formatDuration(s.you.attendedSeconds)
          ) +
          metaRow('Attendance', pct(s.you.attendancePct))
      );
  const rosterRows = s.roster
    ? sectionHeading('Attendance overview') +
      metaTable(
        s.roster
          .slice(0, 25)
          .map((r) =>
            metaRow(
              r.attended
                ? `<span style="color:${EMAIL_COLORS.success};">&#10003;</span>`
                : `<span style="color:${EMAIL_COLORS.danger};">&#10005;</span>`,
              `${escapeHtml(r.name)} &mdash; ${r.attended ? (r.attendedSeconds === null ? 'Attended' : formatDuration(r.attendedSeconds)) : 'Did not attend'}`
            )
          )
          .join('') + (s.roster.length > 25 ? metaRow('', `+ ${s.roster.length - 25} more`) : '')
      )
    : '';
  const body =
    paragraph(`${escapeHtml(date)}<br/>${escapeHtml(time)}`) +
    statGrid([
      {
        value: s.durationSeconds === null ? '—' : formatDuration(s.durationSeconds),
        label: 'Duration',
      },
      { value: `${s.attended}/${s.invited}`, label: 'Attended', tone: 'success' },
      { value: s.peak, label: 'Peak' },
    ]) +
    sectionHeading('Your attendance') +
    you +
    rosterRows +
    sectionHeading('Meeting analytics') +
    metaTable(
      metaRow(
        'Participants',
        `${s.invited} invited, ${s.attended} attended, ${s.noShows} did not attend`
      ) +
        metaRow('Average attendance', pct(s.avgAttendancePct)) +
        metaRow('Peak participants', String(s.peak)) +
        metaRow('Late arrivals', String(s.lateArrivals)) +
        metaRow('Early departures', String(s.earlyDepartures))
    );
  const html = renderShell({
    preheader: `${escapeHtml(ctx.title)} — meeting summary`,
    kicker: 'MEETING COMPLETED',
    heading: escapeHtml(ctx.title),
    body,
    ...(s.analyticsUrl
      ? { ctaLabel: 'View meeting analytics', ctaUrl: escapeHtml(s.analyticsUrl) }
      : {}),
  });
  const textLines = [
    `${ctx.title} — meeting completed`,
    `${date}, ${time}`,
    `Duration: ${s.durationSeconds === null ? '—' : formatDuration(s.durationSeconds)}`,
    `Participants: ${s.invited} invited, ${s.attended} attended, ${s.noShows} did not attend`,
    s.you.noShow
      ? 'You did not attend.'
      : `You attended ${s.you.attendedSeconds === null ? '' : formatDuration(s.you.attendedSeconds)} (${pct(s.you.attendancePct)})`,
    `Average attendance: ${pct(s.avgAttendancePct)}; peak: ${s.peak}; late: ${s.lateArrivals}; early departures: ${s.earlyDepartures}`,
    ...(s.analyticsUrl ? [`Analytics: ${s.analyticsUrl}`] : []),
  ];
  return {
    subject: `Meeting summary: ${ctx.title}`,
    html: finalize(html, ctx, appUrl),
    text: textLines.join('\n') + textTail(ctx, appUrl),
  };
}
