'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Copy, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  useMeeting,
  useMeetingAction,
  useMeetingStats,
  type MeetingDetail,
} from '@/lib/hooks/use-meetings';
import { canJoinNow, formatDuration, pct, statusVariant } from './meeting-format';
import { parseGuestEmails } from './schedule-validation';

type Person = MeetingDetail['participants'][number];

function AttendanceCell({ p }: { p: Person }) {
  const t = useTranslations('meetings.details');
  const a = p.attendance;
  if (!a) return <span className="text-muted-foreground">—</span>;
  if (a.noShow)
    return (
      <Badge variant="destructive" size="sm">
        {t('didNotAttend')}
      </Badge>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5 tabular-nums">
      {formatDuration(a.attendedSeconds)} · {pct(a.attendancePct)}
      {a.lateArrival ? (
        <Badge variant="warning" size="sm">
          {t('late')}
        </Badge>
      ) : null}
      {a.earlyDeparture ? (
        <Badge variant="warning" size="sm">
          {t('leftEarly')}
        </Badge>
      ) : null}
    </span>
  );
}

export function MeetingDetailsClient({ slug }: { slug: string }) {
  const t = useTranslations('meetings.details');
  const tm = useTranslations('meetings');
  const format = useFormatter();
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useMeeting(slug);
  const actions = useMeetingAction(slug);
  const ended = data?.meeting.status === 'ended';
  const stats = useMeetingStats(slug, Boolean(ended));
  const [copied, setCopied] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [inviteRaw, setInviteRaw] = useState('');

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4 sm:p-6" aria-busy="true">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404;
    return (
      <div className="mx-auto max-w-md space-y-3 p-10 text-center">
        <h1 className="text-lg font-semibold">{notFound ? t('notFoundTitle') : t('loadFailed')}</h1>
        <p className="text-muted-foreground text-sm">{notFound ? t('notFoundBody') : ''}</p>
        <Button asChild variant="outline">
          <Link href="/meetings">{t('backToMeetings')}</Link>
        </Button>
      </div>
    );
  }

  const m = data.meeting;
  const start = new Date(m.scheduledStartAt);
  const end = new Date(m.scheduledEndAt);
  const link =
    typeof window === 'undefined' ? m.joinPath : `${window.location.origin}${m.joinPath}`;
  const joinable = data.you.canJoin && canJoinNow(m, data.you.isHost);
  const guestCount = data.participants.filter((p) => p.kind === 'guest').length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t('copyFailed'), variant: 'destructive' });
    }
  };

  const invite = () => {
    const { valid, invalid } = parseGuestEmails(inviteRaw);
    if (invalid.length)
      return toast({
        title: tm('errors.invalidEmails', { emails: invalid.join(', ') }),
        variant: 'destructive',
      });
    if (!valid.length) return;
    // Server converts addresses of organization members into internal participants.
    actions.invite.mutate(
      { participantUserIds: [], guests: valid.map((email) => ({ email })) },
      {
        onSuccess: () => {
          setInviteRaw('');
          toast({ title: t('invited') });
        },
        onError: () => toast({ title: t('inviteFailed'), variant: 'destructive' }),
      }
    );
  };

  const s = stats.data?.summary;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {m.title}
            <Badge variant={statusVariant[m.status]}>{tm(`status.${m.status}`)}</Badge>
          </span>
        }
        description={
          <>
            {format.dateTime(start, { dateStyle: 'full', timeStyle: 'short' })} –{' '}
            {format.dateTime(end, { timeStyle: 'short' })}
            {m.timezone ? ` · ${m.timezone}` : ''}
          </>
        }
        actions={
          <>
            {joinable ? (
              <Button asChild>
                <Link href={`/meet/${slug}`}>
                  <Video aria-hidden="true" />
                  {data.you.isHost && m.status === 'scheduled' ? tm('start') : tm('join')}
                </Link>
              </Button>
            ) : null}
            {data.you.canManage && m.status === 'scheduled' ? (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                {t('cancelMeeting')}
              </Button>
            ) : null}
            {data.you.canManage && m.status === 'live' ? (
              <Button
                variant="destructive"
                disabled={actions.end.isPending}
                onClick={() => actions.end.mutate()}
              >
                {t('endMeeting')}
              </Button>
            ) : null}
          </>
        }
      />

      <section className="surface-card space-y-3 p-4" aria-label={t('overview')}>
        <h2 className="text-sm font-semibold">{t('overview')}</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{t('host')}</dt>
            <dd>{m.host.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('duration')}</dt>
            <dd>{formatDuration(Math.round((end.getTime() - start.getTime()) / 1000))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('people')}</dt>
            <dd>{t('peopleSummary', { count: data.participants.length, guests: guestCount })}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('type')}</dt>
            <dd>{m.isRecurring ? tm('recurring') : m.isInstant ? t('instant') : t('oneTime')}</dd>
          </div>
        </dl>
        {m.description ? (
          <p className="text-muted-foreground whitespace-pre-wrap text-sm">{m.description}</p>
        ) : null}
        {m.status === 'scheduled' || m.status === 'live' ? (
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-xs">
              {link}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t('copied') : t('copyLink')}
            </Button>
          </div>
        ) : null}
      </section>

      {ended ? (
        <section aria-label={t('analytics')} className="space-y-2">
          <h2 className="text-sm font-semibold">{t('analytics')}</h2>
          {stats.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : s ? (
            <>
              <MetricStrip
                items={[
                  {
                    id: 'duration',
                    label: t('duration'),
                    value: formatDuration(s.durationSeconds),
                  },
                  {
                    id: 'attended',
                    label: t('attended'),
                    value: `${s.attendedCount}/${s.invitedCount}`,
                    hint: t('noShows', { count: s.noShowCount }),
                  },
                  { id: 'peak', label: t('peak'), value: s.peakConcurrent },
                  {
                    id: 'avg',
                    label: t('avgAttendance'),
                    value: pct(s.avgAttendancePct),
                    hint: formatDuration(s.avgAttendanceSeconds),
                  },
                ]}
              />
              <MetricStrip
                items={[
                  {
                    id: 'minutes',
                    label: t('participantTime'),
                    value: formatDuration(s.totalParticipantSeconds),
                  },
                  { id: 'late', label: t('lateArrivals'), value: s.lateArrivals },
                  { id: 'early', label: t('earlyDepartures'), value: s.earlyDepartures },
                  {
                    id: 'joins',
                    label: t('joins'),
                    value: s.totalJoins,
                    hint: t('leaves', { count: s.totalLeaves }),
                  },
                ]}
              />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t('analyticsPending')}</p>
          )}
        </section>
      ) : null}

      <section className="surface-card overflow-x-auto p-4" aria-label={t('participants')}>
        <h2 className="mb-2 text-sm font-semibold">{t('participants')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="py-1 text-start font-medium">{t('name')}</th>
              {ended ? <th className="py-1 text-start font-medium">{t('joined')}</th> : null}
              {ended ? <th className="py-1 text-start font-medium">{t('left')}</th> : null}
              {ended ? <th className="py-1 text-start font-medium">{t('attendance')}</th> : null}
              {data.you.canManage && !ended && m.status !== 'cancelled' ? (
                <th className="py-1" />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p) => (
              <tr key={p.participantId} className="border-border border-t align-top">
                <td className="py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {p.name ?? p.email ?? '—'}
                    {p.role === 'host' ? (
                      <Badge size="sm" variant="info">
                        {t('hostBadge')}
                      </Badge>
                    ) : null}
                    {p.kind === 'guest' ? <Badge size="sm">{t('guestBadge')}</Badge> : null}
                  </span>
                  {p.kind === 'guest' && p.email && p.name ? (
                    <span className="text-muted-foreground block text-xs">{p.email}</span>
                  ) : null}
                </td>
                {ended ? (
                  <td className="py-2 tabular-nums">
                    {p.attendance?.firstJoinedAt
                      ? format.dateTime(new Date(p.attendance.firstJoinedAt), {
                          timeStyle: 'short',
                        })
                      : '—'}
                  </td>
                ) : null}
                {ended ? (
                  <td className="py-2 tabular-nums">
                    {p.attendance?.lastLeftAt
                      ? format.dateTime(new Date(p.attendance.lastLeftAt), { timeStyle: 'short' })
                      : '—'}
                  </td>
                ) : null}
                {ended ? (
                  <td className="py-2">
                    <AttendanceCell p={p} />
                  </td>
                ) : null}
                {data.you.canManage && !ended && m.status !== 'cancelled' ? (
                  <td className="py-2 text-end">
                    {p.role !== 'host' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={actions.remove.isPending}
                        onClick={() => actions.remove.mutate(p.participantId)}
                      >
                        {t('remove')}
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        {data.you.canManage && (m.status === 'scheduled' || m.status === 'live') ? (
          <div className="border-border mt-4 space-y-2 border-t pt-3">
            <label htmlFor="invite-emails" className="text-sm font-medium">
              {t('inviteMore')}
            </label>
            <Textarea
              id="invite-emails"
              rows={2}
              value={inviteRaw}
              onChange={(e) => setInviteRaw(e.target.value)}
              placeholder={tm('fields.guestsPlaceholder')}
            />
            <Button
              size="sm"
              onClick={invite}
              disabled={actions.invite.isPending || !inviteRaw.trim()}
            >
              {t('sendInvites')}
            </Button>
          </div>
        ) : null}
      </section>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cancelTitle')}</DialogTitle>
            <DialogDescription>{t('cancelBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {tm('cancel')}
            </Button>
            {m.isRecurring ? (
              <Button
                variant="outline"
                disabled={actions.cancel.isPending}
                onClick={() =>
                  actions.cancel.mutate('series', { onSuccess: () => setCancelOpen(false) })
                }
              >
                {t('cancelSeries')}
              </Button>
            ) : null}
            <Button
              variant="destructive"
              disabled={actions.cancel.isPending}
              onClick={() =>
                actions.cancel.mutate('occurrence', { onSuccess: () => setCancelOpen(false) })
              }
            >
              {m.isRecurring ? t('cancelThisOne') : t('cancelMeeting')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
