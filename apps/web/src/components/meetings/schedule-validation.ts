import { z } from 'zod';
import { isValidTimeZone, zonedToUtc } from '@/lib/meetings/time';

/** Split on commas, semicolons, whitespace; lower-case; de-duplicate. */
export function parseGuestEmails(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emailSchema = z.string().email().max(320);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const tok of [...new Set(tokens)])
    (emailSchema.safeParse(tok).success ? valid : invalid).push(tok);
  return { valid, invalid };
}

/**
 * Combine a local date (YYYY-MM-DD) and time (HH:mm) in an IANA zone into an
 * ISO instant, using the same DST rules as the server (shared helper).
 */
export function zonedInputToIso(date: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !tm || !isValidTimeZone(timeZone)) return null;
  const instant = zonedToUtc(
    {
      year: Number(d[1]),
      month: Number(d[2]),
      day: Number(d[3]),
      hour: Number(tm[1]),
      minute: Number(tm[2]),
    },
    timeZone
  );
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}
