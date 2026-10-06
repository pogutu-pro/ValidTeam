/**
 * Minimal RFC 5545 generator for meeting invitations. Attached to the
 * invitation email so any calendar client can add the meeting; there is no
 * calendar-provider integration in ValidTeam, so none is introduced here.
 *
 * Series: the first-occurrence invite carries an RRULE with DTSTART;TZID so the
 * wall-clock time survives DST. One-off meetings use plain UTC.
 */
import type { RecurrenceRule } from './recurrence';
import { toLocalDateTime, weekdayOf } from './time';

export interface IcsInput {
  uid: string;
  title: string;
  description?: string | null;
  url: string;
  start: Date;
  end: Date;
  organizerName: string;
  attendeeEmail?: string;
  cancelled?: boolean;
  recurrence?: { rule: RecurrenceRule; timezone: string } | null;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const utc = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

export const escapeIcsText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold to 75 octets per line as required by the RFC. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function rruleFor(rule: RecurrenceRule, timezone: string, anchor: Date): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${rule.interval ?? 1}`];
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday ?? [weekdayOf(toLocalDateTime(anchor, timezone))];
    parts.push(
      `BYDAY=${[...new Set(days)]
        .sort((a, b) => a - b)
        .map((d) => WEEKDAYS[d])
        .join(',')}`
    );
  }
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${utc(new Date(rule.until))}`);
  return parts.join(';');
}

export function buildIcs(input: IcsInput): string {
  const local = input.recurrence ? toLocalDateTime(input.start, input.recurrence.timezone) : null;
  const localStamp = (d: Date) => {
    const l = toLocalDateTime(d, input.recurrence!.timezone);
    return `${pad(l.year, 4)}${pad(l.month)}${pad(l.day)}T${pad(l.hour)}${pad(l.minute)}00`;
  };
  const dtstart = local
    ? `DTSTART;TZID=${input.recurrence!.timezone}:${localStamp(input.start)}`
    : `DTSTART:${utc(input.start)}`;
  const dtend = local
    ? `DTEND;TZID=${input.recurrence!.timezone}:${localStamp(input.end)}`
    : `DTEND:${utc(input.end)}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ValidTeam//Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}@validteam`,
    `DTSTAMP:${utc(new Date())}`,
    dtstart,
    dtend,
    ...(input.recurrence
      ? [`RRULE:${rruleFor(input.recurrence.rule, input.recurrence.timezone, input.start)}`]
      : []),
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(`${input.description ? `${input.description}\n\n` : ''}Join: ${input.url}`)}`,
    `URL:${input.url}`,
    `LOCATION:${escapeIcsText(input.url)}`,
    `ORGANIZER;CN=${escapeIcsText(input.organizerName)}:mailto:noreply@validteam.invalid`,
    ...(input.attendeeEmail ? [`ATTENDEE;RSVP=FALSE:mailto:${input.attendeeEmail}`] : []),
    `STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function googleCalendarUrl(
  input: Pick<IcsInput, 'title' | 'description' | 'url' | 'start' | 'end'>
): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${utc(input.start)}/${utc(input.end)}`,
    details: `${input.description ? `${input.description}\n\n` : ''}Join: ${input.url}`,
    location: input.url,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
