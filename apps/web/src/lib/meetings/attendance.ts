/**
 * Pure attendance + statistics math. No I/O: everything here is derived from
 * attendance-session intervals so the numbers are reproducible and testable.
 *
 * Attendance is the UNION of a participant's session intervals clamped to the
 * meeting window — never last_leave - first_join — so gaps between a leave and
 * a rejoin are not counted, and two tabs open at once are not double counted.
 */

export const LATE_ARRIVAL_GRACE_MS = 5 * 60_000;
export const EARLY_DEPARTURE_GRACE_MS = 5 * 60_000;

export interface SessionInterval {
  participantId: string;
  joinedAt: Date;
  /** null = still open; closed at the meeting end by the caller/this module. */
  leftAt: Date | null;
}

export interface ParticipantRef {
  id: string;
  userId: string | null;
}

export interface MeetingWindow {
  scheduledStartAt: Date;
  isInstant: boolean;
  /** Meeting end (host end / auto end). Required to compute stats. */
  endedAt: Date;
}

export interface ParticipantAttendance {
  participantId: string;
  firstJoinedAt: Date | null;
  lastLeftAt: Date | null;
  attendedSeconds: number;
  /** null when the meeting duration is unknown/zero. */
  attendancePct: number | null;
  joinCount: number;
  leaveCount: number;
  lateArrival: boolean;
  earlyDeparture: boolean;
  noShow: boolean;
}

export interface MeetingStatsResult {
  startedAt: Date | null;
  endedAt: Date;
  durationSeconds: number | null;
  invitedCount: number;
  attendedCount: number;
  noShowCount: number;
  peakConcurrent: number;
  totalParticipantSeconds: number;
  avgAttendanceSeconds: number | null;
  avgAttendancePct: number | null;
  lateArrivals: number;
  earlyDepartures: number;
  totalJoins: number;
  totalLeaves: number;
  participants: ParticipantAttendance[];
}

type Interval = [number, number];

/** Merge overlapping/touching intervals (ms). Input need not be sorted. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function clamp(interval: Interval, lo: number, hi: number): Interval | null {
  const s = Math.max(interval[0], lo);
  const e = Math.min(interval[1], hi);
  return e > s ? [s, e] : null;
}

/** Maximum number of distinct participants present at the same instant. */
export function peakConcurrent(perParticipant: Interval[][]): number {
  const events: Array<[number, number]> = [];
  for (const merged of perParticipant) {
    for (const [s, e] of merged) {
      events.push([s, 1], [e, -1]);
    }
  }
  // Departures sort before arrivals at the same instant (back-to-back is not overlap).
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let peak = 0;
  for (const [, delta] of events) {
    cur += delta;
    peak = Math.max(peak, cur);
  }
  return peak;
}

export function computeMeetingStats(input: {
  window: MeetingWindow;
  participants: ParticipantRef[];
  sessions: SessionInterval[];
}): MeetingStatsResult {
  const { window, participants, sessions } = input;
  const endMs = window.endedAt.getTime();

  // Close open sessions at meeting end and drop anything starting after it.
  const byParticipant = new Map<string, SessionInterval[]>();
  for (const s of sessions) {
    if (s.joinedAt.getTime() > endMs) continue;
    const list = byParticipant.get(s.participantId) ?? [];
    list.push(s);
    byParticipant.set(s.participantId, list);
  }

  const allStarts = sessions
    .filter((s) => s.joinedAt.getTime() <= endMs)
    .map((s) => s.joinedAt.getTime());
  const startMs = allStarts.length ? Math.min(...allStarts) : null;
  const durationMs = startMs !== null && endMs > startMs ? endMs - startMs : null;

  // Reference for lateness: never earlier than the actual start, so the first
  // person in is not "late" just because the host opened the room late.
  const lateRef =
    startMs === null
      ? null
      : window.isInstant
        ? startMs
        : Math.max(window.scheduledStartAt.getTime(), startMs);

  const perParticipantIntervals: Interval[][] = [];
  const results: ParticipantAttendance[] = [];

  for (const p of participants) {
    const own = byParticipant.get(p.id) ?? [];
    if (own.length === 0 || startMs === null) {
      results.push({
        participantId: p.id,
        firstJoinedAt: null,
        lastLeftAt: null,
        attendedSeconds: 0,
        attendancePct: durationMs ? 0 : null,
        joinCount: 0,
        leaveCount: 0,
        lateArrival: false,
        earlyDeparture: false,
        noShow: true,
      });
      continue;
    }

    const clamped = own
      .map((s): Interval | null =>
        clamp([s.joinedAt.getTime(), (s.leftAt ?? window.endedAt).getTime()], startMs, endMs)
      )
      .filter((i): i is Interval => i !== null);
    const merged = mergeIntervals(clamped);
    perParticipantIntervals.push(merged);

    const attendedMs = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
    const attendedSeconds = Math.round(attendedMs / 1000);
    const firstJoin = Math.min(...own.map((s) => s.joinedAt.getTime()));
    const lastLeaveMs = Math.max(...own.map((s) => (s.leftAt ?? window.endedAt).getTime()));
    const closedLeaves = own.filter((s) => s.leftAt !== null).length;

    results.push({
      participantId: p.id,
      firstJoinedAt: new Date(firstJoin),
      lastLeftAt: new Date(Math.min(lastLeaveMs, endMs)),
      attendedSeconds,
      attendancePct: durationMs ? Math.min(100, round1((attendedMs / durationMs) * 100)) : null,
      joinCount: own.length,
      leaveCount: closedLeaves,
      lateArrival: lateRef !== null && firstJoin > lateRef + LATE_ARRIVAL_GRACE_MS,
      earlyDeparture: Math.min(lastLeaveMs, endMs) < endMs - EARLY_DEPARTURE_GRACE_MS,
      noShow: false,
    });
  }

  const attendees = results.filter((r) => !r.noShow);
  const totalSeconds = attendees.reduce((s, r) => s + r.attendedSeconds, 0);
  const pcts = attendees.map((r) => r.attendancePct).filter((v): v is number => v !== null);

  return {
    startedAt: startMs === null ? null : new Date(startMs),
    endedAt: window.endedAt,
    durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),
    invitedCount: participants.length,
    attendedCount: attendees.length,
    noShowCount: results.length - attendees.length,
    peakConcurrent: peakConcurrent(perParticipantIntervals),
    totalParticipantSeconds: totalSeconds,
    avgAttendanceSeconds: attendees.length ? Math.round(totalSeconds / attendees.length) : null,
    avgAttendancePct: pcts.length ? round1(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
    lateArrivals: attendees.filter((r) => r.lateArrival).length,
    earlyDepartures: attendees.filter((r) => r.earlyDeparture).length,
    totalJoins: results.reduce((s, r) => s + r.joinCount, 0),
    totalLeaves: results.reduce((s, r) => s + r.leaveCount, 0),
    participants: results,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
