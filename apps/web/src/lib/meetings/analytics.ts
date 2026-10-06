/**
 * Meeting analytics. Reads only the precomputed per-meeting rollups
 * (`meeting_stats`) and per-participant rollups (columns on
 * `meeting_participants`), never raw attendance sessions, so dashboards stay
 * cheap for organizations with many meetings. EVERY query filters by
 * organization_id (no RLS). Metrics that cannot be derived are null.
 */
import {
  db,
  meetings,
  meetingStats,
  meetingParticipants,
  users,
  and,
  eq,
  gte,
  lt,
  sql,
} from '@validteam/db';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { isValidTimeZone } from './time';

export const analyticsQuerySchema = z.object({
  organizationId: z.string().min(1),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
  timezone: z.string().refine(isValidTimeZone, 'Invalid IANA time zone').default('UTC'),
  scope: z.enum(['organization', 'me']).default('organization'),
  recurring: z.enum(['true', 'false']).optional(),
  external: z.enum(['true', 'false']).optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const MAX_RANGE_DAYS = 400;

const ratio = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Safe literal for SQL fragments that must repeat in SELECT and GROUP BY. */
function tzLiteral(tz: string): SQL {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz) || !isValidTimeZone(tz)) throw new Error('Invalid time zone');
  return sql.raw(`'${tz}'`);
}
const bucketLiteral = (b: AnalyticsQuery['bucket']): SQL => sql.raw(`'${b}'`);

export async function getOrganizationMeetingAnalytics(q: AnalyticsQuery) {
  const from = new Date(q.from);
  const to = new Date(q.to);
  const orgId = q.organizationId;
  const tz = tzLiteral(q.timezone);
  const bucket = bucketLiteral(q.bucket);

  const statFilters: SQL[] = [
    eq(meetingStats.organizationId, orgId),
    gte(meetingStats.scheduledStartAt, from),
    lt(meetingStats.scheduledStartAt, to),
  ];
  if (q.recurring) statFilters.push(eq(meetingStats.isRecurring, q.recurring === 'true'));
  if (q.external) statFilters.push(eq(meetingStats.hasExternalGuests, q.external === 'true'));

  const meetingFilters = [
    eq(meetings.organizationId, orgId),
    gte(meetings.scheduledStartAt, from),
    lt(meetings.scheduledStartAt, to),
  ];

  const [volumeRows, [live], [totals], trendMeetings, trendStats, hosts, people] =
    await Promise.all([
      db
        .select({ status: meetings.status, count: sql<number>`count(*)::int` })
        .from(meetings)
        .where(and(...meetingFilters))
        .groupBy(meetings.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(meetings)
        .where(and(eq(meetings.organizationId, orgId), eq(meetings.status, 'live'))),
      db
        .select({
          meetings: sql<number>`count(*)::int`,
          withAttendance: sql<number>`count(*) FILTER (WHERE ${meetingStats.durationSeconds} IS NOT NULL)::int`,
          durationSeconds: sql<number>`coalesce(sum(${meetingStats.durationSeconds}), 0)::bigint`,
          avgDurationSeconds: sql<number | null>`avg(${meetingStats.durationSeconds})`,
          invited: sql<number>`coalesce(sum(${meetingStats.invitedCount}), 0)::int`,
          attended: sql<number>`coalesce(sum(${meetingStats.attendedCount}), 0)::int`,
          noShows: sql<number>`coalesce(sum(${meetingStats.noShowCount}), 0)::int`,
          late: sql<number>`coalesce(sum(${meetingStats.lateArrivals}), 0)::int`,
          early: sql<number>`coalesce(sum(${meetingStats.earlyDepartures}), 0)::int`,
          participantSeconds: sql<number>`coalesce(sum(${meetingStats.totalParticipantSeconds}), 0)::bigint`,
          avgPeak: sql<
            number | null
          >`avg(${meetingStats.peakConcurrent}) FILTER (WHERE ${meetingStats.attendedCount} > 0)`,
          avgInvited: sql<number | null>`avg(${meetingStats.invitedCount})`,
        })
        .from(meetingStats)
        .where(and(...statFilters)),
      db
        .select({
          bucket: sql<string>`to_char(date_trunc(${bucket}, ${meetings.scheduledStartAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) FILTER (WHERE ${meetings.status} = 'ended')::int`,
          cancelled: sql<number>`count(*) FILTER (WHERE ${meetings.status} = 'cancelled')::int`,
        })
        .from(meetings)
        .where(and(...meetingFilters))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          bucket: sql<string>`to_char(date_trunc(${bucket}, ${meetingStats.scheduledStartAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD')`,
          durationSeconds: sql<number>`coalesce(sum(${meetingStats.durationSeconds}), 0)::bigint`,
          invited: sql<number>`coalesce(sum(${meetingStats.invitedCount}), 0)::int`,
          attended: sql<number>`coalesce(sum(${meetingStats.attendedCount}), 0)::int`,
          noShows: sql<number>`coalesce(sum(${meetingStats.noShowCount}), 0)::int`,
        })
        .from(meetingStats)
        .where(and(...statFilters))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          userId: meetingStats.hostId,
          name: users.name,
          email: users.email,
          hosted: sql<number>`count(*)::int`,
        })
        .from(meetingStats)
        .innerJoin(users, eq(users.id, meetingStats.hostId))
        .where(and(...statFilters))
        .groupBy(meetingStats.hostId, users.name, users.email)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .select({
          userId: meetingParticipants.userId,
          name: users.name,
          email: users.email,
          invited: sql<number>`count(*)::int`,
          attended: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = false)::int`,
          noShows: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = true)::int`,
          attendedSeconds: sql<number>`coalesce(sum(${meetingParticipants.attendedSeconds}), 0)::bigint`,
          avgAttendancePct: sql<
            number | null
          >`avg(${meetingParticipants.attendancePct}) FILTER (WHERE ${meetingParticipants.noShow} = false)`,
        })
        .from(meetingParticipants)
        .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
        .innerJoin(users, eq(users.id, meetingParticipants.userId))
        .where(
          and(
            eq(meetingParticipants.organizationId, orgId),
            eq(meetings.organizationId, orgId),
            sql`${meetingParticipants.statsComputedAt} IS NOT NULL`,
            gte(meetings.scheduledStartAt, from),
            lt(meetings.scheduledStartAt, to)
          )
        )
        .groupBy(meetingParticipants.userId, users.name, users.email)
        .orderBy(sql`sum(${meetingParticipants.attendedSeconds}) desc nulls last`)
        .limit(25),
    ]);

  const byStatus = Object.fromEntries(volumeRows.map((r) => [r.status, r.count])) as Record<
    string,
    number
  >;
  const attended = n(totals?.attended);
  const invited = n(totals?.invited);

  return {
    range: { from: q.from, to: q.to, bucket: q.bucket, timezone: q.timezone },
    volume: {
      total: volumeRows.reduce((s, r) => s + r.count, 0),
      scheduled: byStatus.scheduled ?? 0,
      completed: byStatus.ended ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      live: n(live?.count), // currently live, regardless of range
    },
    attendance: {
      invited,
      attended,
      noShows: n(totals?.noShows),
      attendanceRate: ratio(attended, invited),
      noShowRate: ratio(n(totals?.noShows), invited),
      lateArrivalRate: ratio(n(totals?.late), attended),
      earlyDepartureRate: ratio(n(totals?.early), attended),
    },
    time: {
      totalMeetingHours: Math.round((n(totals?.durationSeconds) / 3600) * 10) / 10,
      avgMeetingDurationSeconds:
        totals?.avgDurationSeconds === null ? null : Math.round(n(totals?.avgDurationSeconds)),
      avgAttendanceDurationSeconds:
        attended > 0 ? Math.round(n(totals?.participantSeconds) / attended) : null,
      totalParticipantHours: Math.round((n(totals?.participantSeconds) / 3600) * 10) / 10,
    },
    health: {
      meetingsWithAttendance: n(totals?.withAttendance),
      avgPeakParticipants:
        nOrNull(totals?.avgPeak) === null ? null : Math.round(n(totals?.avgPeak) * 10) / 10,
      avgInvitedPerMeeting:
        nOrNull(totals?.avgInvited) === null ? null : Math.round(n(totals?.avgInvited) * 10) / 10,
    },
    participation: {
      topHosts: hosts.map((h) => ({
        userId: h.userId,
        name: h.name,
        email: h.email,
        hosted: h.hosted,
      })),
      people: people.map((p) => ({
        userId: p.userId,
        name: p.name,
        email: p.email,
        invited: p.invited,
        attended: p.attended,
        noShows: p.noShows,
        attendedSeconds: n(p.attendedSeconds),
        avgAttendancePct:
          p.avgAttendancePct === null ? null : Math.round(n(p.avgAttendancePct) * 10) / 10,
      })),
    },
    trends: mergeTrends(trendMeetings, trendStats),
  };
}

function mergeTrends(
  m: Array<{ bucket: string; count: number; completed: number; cancelled: number }>,
  s: Array<{
    bucket: string;
    durationSeconds: number;
    invited: number;
    attended: number;
    noShows: number;
  }>
) {
  const map = new Map<string, Record<string, number | string | null>>();
  for (const r of m)
    map.set(r.bucket, {
      bucket: r.bucket,
      meetings: r.count,
      completed: r.completed,
      cancelled: r.cancelled,
      meetingHours: 0,
      attendanceRate: null,
      noShowRate: null,
    });
  for (const r of s) {
    const row = map.get(r.bucket) ?? { bucket: r.bucket, meetings: 0, completed: 0, cancelled: 0 };
    row.meetingHours = Math.round((n(r.durationSeconds) / 3600) * 10) / 10;
    row.attendanceRate = ratio(n(r.attended), n(r.invited));
    row.noShowRate = ratio(n(r.noShows), n(r.invited));
    map.set(r.bucket, row);
  }
  return [...map.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

/** Personal participation for one user inside one organization. */
export async function getPersonalMeetingAnalytics(userId: string, q: AnalyticsQuery) {
  const from = new Date(q.from);
  const to = new Date(q.to);
  const tz = tzLiteral(q.timezone);
  const bucket = bucketLiteral(q.bucket);
  const where = and(
    eq(meetingParticipants.organizationId, q.organizationId),
    eq(meetings.organizationId, q.organizationId),
    eq(meetingParticipants.userId, userId),
    sql`${meetingParticipants.statsComputedAt} IS NOT NULL`,
    gte(meetings.scheduledStartAt, from),
    lt(meetings.scheduledStartAt, to)
  );

  const [[totals], trend, history, [hosted]] = await Promise.all([
    db
      .select({
        invited: sql<number>`count(*)::int`,
        attended: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = false)::int`,
        missed: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = true)::int`,
        seconds: sql<number>`coalesce(sum(${meetingParticipants.attendedSeconds}), 0)::bigint`,
        avgPct: sql<
          number | null
        >`avg(${meetingParticipants.attendancePct}) FILTER (WHERE ${meetingParticipants.noShow} = false)`,
        late: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.lateArrival} = true)::int`,
        early: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.earlyDeparture} = true)::int`,
        joins: sql<number>`coalesce(sum(${meetingParticipants.joinCount}), 0)::int`,
      })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
      .where(where),
    db
      .select({
        bucket: sql<string>`to_char(date_trunc(${bucket}, ${meetings.scheduledStartAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD')`,
        attended: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = false)::int`,
        missed: sql<number>`count(*) FILTER (WHERE ${meetingParticipants.noShow} = true)::int`,
        seconds: sql<number>`coalesce(sum(${meetingParticipants.attendedSeconds}), 0)::bigint`,
        avgPct: sql<
          number | null
        >`avg(${meetingParticipants.attendancePct}) FILTER (WHERE ${meetingParticipants.noShow} = false)`,
      })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        slug: meetings.slug,
        title: meetings.title,
        scheduledStartAt: meetings.scheduledStartAt,
        attendedSeconds: meetingParticipants.attendedSeconds,
        attendancePct: meetingParticipants.attendancePct,
        noShow: meetingParticipants.noShow,
        lateArrival: meetingParticipants.lateArrival,
        earlyDeparture: meetingParticipants.earlyDeparture,
      })
      .from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meetingId))
      .where(where)
      .orderBy(sql`${meetings.scheduledStartAt} desc`)
      .limit(25),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(meetings)
      .where(
        and(
          eq(meetings.organizationId, q.organizationId),
          eq(meetings.hostId, userId),
          gte(meetings.scheduledStartAt, from),
          lt(meetings.scheduledStartAt, to)
        )
      ),
  ]);

  const attended = n(totals?.attended);
  return {
    range: { from: q.from, to: q.to, bucket: q.bucket, timezone: q.timezone },
    summary: {
      invited: n(totals?.invited),
      attended,
      missed: n(totals?.missed),
      hosted: n(hosted?.count),
      totalMeetingHours: Math.round((n(totals?.seconds) / 3600) * 10) / 10,
      avgAttendanceSeconds: attended > 0 ? Math.round(n(totals?.seconds) / attended) : null,
      avgAttendancePct:
        nOrNull(totals?.avgPct) === null ? null : Math.round(n(totals?.avgPct) * 10) / 10,
      lateArrivals: n(totals?.late),
      earlyDepartures: n(totals?.early),
      totalJoins: n(totals?.joins),
    },
    trend: trend.map((t) => ({
      bucket: t.bucket,
      attended: t.attended,
      missed: t.missed,
      hours: Math.round((n(t.seconds) / 3600) * 10) / 10,
      avgAttendancePct: nOrNull(t.avgPct) === null ? null : Math.round(n(t.avgPct) * 10) / 10,
    })),
    history,
  };
}

export async function getMeetingAnalyticsDetail(meetingId: string, organizationId: string) {
  const [stats] = await db
    .select()
    .from(meetingStats)
    .where(
      and(eq(meetingStats.meetingId, meetingId), eq(meetingStats.organizationId, organizationId))
    )
    .limit(1);
  return stats ?? null;
}
