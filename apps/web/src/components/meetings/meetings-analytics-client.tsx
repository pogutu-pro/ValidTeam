'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganizationMembers } from '@/lib/hooks/use-members';
import { useOrganization } from '@/lib/hooks/use-organization';
import {
  useMeetingAnalytics,
  type OrgMeetingAnalytics,
  type PersonalMeetingAnalytics,
} from '@/lib/hooks/use-meetings';
import { bucketFor, resolveRange, type RangePreset } from './analytics-range';
import { formatDuration, pct } from './meeting-format';

const FIELD =
  'border-border bg-background h-8 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;
const GRID = 'hsl(var(--border))';

function ChartCard({
  title,
  children,
  empty,
  emptyLabel,
}: {
  title: string;
  children: React.ReactNode;
  empty: boolean;
  emptyLabel: string;
}) {
  return (
    <section className="surface-card space-y-3 p-4" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {empty ? (
        <p className="text-muted-foreground py-10 text-center text-xs">{emptyLabel}</p>
      ) : (
        <div className="h-60 w-full">{children}</div>
      )}
    </section>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="surface-card space-y-1 px-3 py-2 text-xs">
      <p className="text-muted-foreground font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold tabular-nums">{p.value ?? '—'}</span>
        </p>
      ))}
    </div>
  );
}

function OrgView({ data }: { data: OrgMeetingAnalytics }) {
  const t = useTranslations('meetings.analyticsPage');
  const none = t('noData');
  const trends = data.trends;
  return (
    <div className="space-y-4">
      <MetricStrip
        items={[
          {
            id: 'total',
            label: t('kpi.total'),
            value: data.volume.total,
            hint: t('kpi.completedCancelled', {
              completed: data.volume.completed,
              cancelled: data.volume.cancelled,
            }),
          },
          { id: 'hours', label: t('kpi.hours'), value: `${data.time.totalMeetingHours}h` },
          {
            id: 'attendance',
            label: t('kpi.attendance'),
            value: pct(data.attendance.attendanceRate),
            hint: t('kpi.attendedOfInvited', {
              attended: data.attendance.attended,
              invited: data.attendance.invited,
            }),
          },
          {
            id: 'noshow',
            label: t('kpi.noShow'),
            value: pct(data.attendance.noShowRate),
            hint: t('kpi.noShowCount', { count: data.attendance.noShows }),
          },
        ]}
      />
      <MetricStrip
        items={[
          {
            id: 'duration',
            label: t('kpi.avgDuration'),
            value: formatDuration(data.time.avgMeetingDurationSeconds),
          },
          {
            id: 'attDuration',
            label: t('kpi.avgAttended'),
            value: formatDuration(data.time.avgAttendanceDurationSeconds),
          },
          {
            id: 'late',
            label: t('kpi.late'),
            value: pct(data.attendance.lateArrivalRate),
            hint: t('kpi.earlyHint', { rate: pct(data.attendance.earlyDepartureRate) }),
          },
          {
            id: 'live',
            label: t('kpi.live'),
            value: data.volume.live,
            hint: t('kpi.peakHint', { peak: data.health.avgPeakParticipants ?? '—' }),
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t('charts.volume')} empty={trends.length === 0} emptyLabel={none}>
          <ResponsiveContainer>
            <ComposedChart data={trends}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={AXIS} />
              <YAxis yAxisId="l" tick={AXIS} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={AXIS} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="l"
                dataKey="meetings"
                name={t('charts.meetings')}
                fill="hsl(var(--accent-blue))"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="r"
                dataKey="meetingHours"
                name={t('charts.hours')}
                stroke="hsl(var(--accent-amber))"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title={t('charts.attendance')}
          empty={trends.every((x) => x.attendanceRate === null)}
          emptyLabel={none}
        >
          <ResponsiveContainer>
            <LineChart data={trends}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={AXIS} />
              <YAxis tick={AXIS} domain={[0, 100]} unit="%" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                dataKey="attendanceRate"
                name={t('charts.attendanceRate')}
                stroke="hsl(var(--accent-emerald))"
                strokeWidth={2}
                connectNulls
              />
              <Line
                dataKey="noShowRate"
                name={t('charts.noShowRate')}
                stroke="hsl(var(--accent-rose))"
                strokeWidth={2}
                strokeDasharray="5 3"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section
          className="surface-card overflow-x-auto p-4 lg:col-span-2"
          aria-label={t('tables.people')}
        >
          <h2 className="mb-2 text-sm font-semibold">{t('tables.people')}</h2>
          {data.participation.people.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">{none}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-start text-xs">
                  <th className="py-1 text-start font-medium">{t('tables.person')}</th>
                  <th className="py-1 text-end font-medium">{t('tables.attended')}</th>
                  <th className="py-1 text-end font-medium">{t('tables.missed')}</th>
                  <th className="py-1 text-end font-medium">{t('tables.time')}</th>
                  <th className="py-1 text-end font-medium">{t('tables.avg')}</th>
                </tr>
              </thead>
              <tbody>
                {data.participation.people.map((p) => (
                  <tr key={p.userId} className="border-border border-t">
                    <td className="max-w-[16rem] truncate py-1.5">{p.name ?? p.email}</td>
                    <td className="py-1.5 text-end tabular-nums">{p.attended}</td>
                    <td className="py-1.5 text-end tabular-nums">{p.noShows}</td>
                    <td className="py-1.5 text-end tabular-nums">
                      {formatDuration(p.attendedSeconds)}
                    </td>
                    <td className="py-1.5 text-end tabular-nums">{pct(p.avgAttendancePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="surface-card p-4" aria-label={t('tables.hosts')}>
          <h2 className="mb-2 text-sm font-semibold">{t('tables.hosts')}</h2>
          {data.participation.topHosts.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">{none}</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {data.participation.topHosts.map((h) => (
                <li key={h.userId} className="flex justify-between gap-2">
                  <span className="truncate">{h.name ?? h.email}</span>
                  <span className="tabular-nums">{h.hosted}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function MeView({ data }: { data: PersonalMeetingAnalytics }) {
  const t = useTranslations('meetings.analyticsPage');
  const format = useFormatter();
  const s = data.summary;
  return (
    <div className="space-y-4">
      <MetricStrip
        items={[
          {
            id: 'attended',
            label: t('me.attended'),
            value: s.attended,
            hint: t('me.invitedHint', { count: s.invited }),
          },
          { id: 'missed', label: t('me.missed'), value: s.missed },
          { id: 'hours', label: t('me.hours'), value: `${s.totalMeetingHours}h` },
          { id: 'hosted', label: t('me.hosted'), value: s.hosted },
        ]}
      />
      <MetricStrip
        items={[
          { id: 'avgDur', label: t('me.avgTime'), value: formatDuration(s.avgAttendanceSeconds) },
          { id: 'avgPct', label: t('me.avgPct'), value: pct(s.avgAttendancePct) },
          { id: 'late', label: t('kpi.late'), value: s.lateArrivals },
          { id: 'early', label: t('me.early'), value: s.earlyDepartures },
        ]}
      />
      <ChartCard title={t('me.trend')} empty={data.trend.length === 0} emptyLabel={t('noData')}>
        <ResponsiveContainer>
          <ComposedChart data={data.trend}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tick={AXIS} />
            <YAxis tick={AXIS} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="attended"
              name={t('me.attended')}
              fill="hsl(var(--accent-emerald))"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="missed"
              name={t('me.missed')}
              fill="hsl(var(--accent-rose))"
              radius={[2, 2, 0, 0]}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <section className="surface-card overflow-x-auto p-4" aria-label={t('me.history')}>
        <h2 className="mb-2 text-sm font-semibold">{t('me.history')}</h2>
        {data.history.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">{t('noData')}</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {data.history.map((h) => (
              <li key={h.slug} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/meetings/${h.slug}`} className="min-w-0 truncate hover:underline">
                  {h.title}
                </Link>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {format.dateTime(new Date(h.scheduledStartAt), {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  ·{' '}
                  {h.noShow
                    ? t('me.didNotAttend')
                    : `${formatDuration(h.attendedSeconds)} (${pct(h.attendancePct)})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MeetingsAnalyticsClient() {
  const t = useTranslations('meetings.analyticsPage');
  const { currentOrganizationId } = useOrganization();
  const { data: members } = useOrganizationMembers(currentOrganizationId);
  const isAdmin = members?.userRole === 'owner' || members?.userRole === 'admin';

  const [scope, setScope] = useState<'organization' | 'me'>('me');
  const [preset, setPreset] = useState<RangePreset>('last30');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [recurring, setRecurring] = useState<'all' | 'true' | 'false'>('all');
  const [external, setExternal] = useState<'all' | 'true' | 'false'>('all');

  const effectiveScope = isAdmin ? scope : 'me';
  const range = useMemo(() => resolveRange(preset, new Date(), custom), [preset, custom]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const valid = range.to > range.from;

  const shared = {
    organizationId: currentOrganizationId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    bucket: bucketFor(range),
    timezone,
    enabled: valid,
  } as const;
  const org = useMeetingAnalytics<'organization'>({
    ...shared,
    scope: 'organization',
    recurring: recurring === 'all' ? undefined : recurring === 'true',
    external: external === 'all' ? undefined : external === 'true',
    enabled: valid && effectiveScope === 'organization',
  });
  const me = useMeetingAnalytics<'me'>({
    ...shared,
    scope: 'me',
    enabled: valid && effectiveScope === 'me',
  });
  const active = effectiveScope === 'organization' ? org : me;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/meetings">{t('back')}</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <TabsList>
              <TabsTrigger value="me">{t('scope.me')}</TabsTrigger>
              <TabsTrigger value="organization">{t('scope.organization')}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t('filters.range')}</span>
          <select
            className={FIELD}
            value={preset}
            onChange={(e) => setPreset(e.target.value as RangePreset)}
          >
            {(['today', 'week', 'month', 'last30', 'last90', 'custom'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`presets.${p}`)}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' ? (
          <>
            <input
              type="date"
              aria-label={t('filters.from')}
              className={FIELD}
              value={custom.from}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
            <input
              type="date"
              aria-label={t('filters.to')}
              className={FIELD}
              value={custom.to}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </>
        ) : null}
        {effectiveScope === 'organization' ? (
          <>
            <select
              aria-label={t('filters.recurrence')}
              className={FIELD}
              value={recurring}
              onChange={(e) => setRecurring(e.target.value as typeof recurring)}
            >
              <option value="all">{t('filters.allMeetings')}</option>
              <option value="true">{t('filters.recurring')}</option>
              <option value="false">{t('filters.oneTime')}</option>
            </select>
            <select
              aria-label={t('filters.guests')}
              className={FIELD}
              value={external}
              onChange={(e) => setExternal(e.target.value as typeof external)}
            >
              <option value="all">{t('filters.anyGuests')}</option>
              <option value="true">{t('filters.withGuests')}</option>
              <option value="false">{t('filters.internalOnly')}</option>
            </select>
          </>
        ) : null}
      </div>

      {!valid ? (
        <p role="alert" className="text-destructive text-sm">
          {t('invalidRange')}
        </p>
      ) : active.isLoading || !currentOrganizationId ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : active.isError ? (
        <p role="alert" className="text-muted-foreground text-sm">
          {t('loadFailed')}
        </p>
      ) : effectiveScope === 'organization' && org.data ? (
        <OrgView data={org.data} />
      ) : me.data ? (
        <MeView data={me.data} />
      ) : null}
    </div>
  );
}
