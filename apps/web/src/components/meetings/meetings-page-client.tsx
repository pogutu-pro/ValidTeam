'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import {
  BarChart3,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  Keyboard,
  Link2,
  Repeat,
  Users,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useOrganization } from '@/lib/hooks/use-organization';
import { cn } from '@/lib/utils';
import { useCreateMeeting, useMeetings, type MeetingListItem } from '@/lib/hooks/use-meetings';
import { PersonAvatar } from './room/stage';
import { CTA_BLUE, canJoinNow, extractMeetingSlug, groupByDay } from './meeting-format';
import { ScheduleMeetingDialog } from './schedule-meeting-dialog';

function useCopyLink() {
  const t = useTranslations('meetings');
  const { toast } = useToast();
  return async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${slug}`);
      toast({ title: t('linkCopied') });
    } catch {
      toast({ title: t('linkCopyFailed'), variant: 'destructive' });
    }
  };
}

function LiveCard({ meeting }: { meeting: MeetingListItem }) {
  const t = useTranslations('meetings');
  const hostName = meeting.host.name ?? meeting.host.email ?? '—';
  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="bg-accent-emerald absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" />
          <span className="bg-accent-emerald relative inline-flex h-2.5 w-2.5 rounded-full" />
        </span>
        <span className="text-accent-emerald text-xs font-semibold uppercase tracking-wide">
          {t('status.live')}
        </span>
      </div>
      <div className="min-w-0">
        <Link
          href={`/meetings/${meeting.slug}`}
          className="text-foreground block truncate text-base font-semibold hover:underline"
        >
          {meeting.title}
        </Link>
        <p className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
          <PersonAvatar name={hostName} className="h-5 w-5 text-[9px]" />
          <span className="truncate">{t('hostedBy', { name: hostName })}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {t('participantCount', { count: meeting.participantCount })}
          </span>
        </p>
      </div>
      <Button asChild className={cn(CTA_BLUE, 'h-11 w-full font-semibold')}>
        <Link href={`/meet/${meeting.slug}`}>
          <Video aria-hidden="true" />
          {t('joinNow')}
        </Link>
      </Button>
    </li>
  );
}

function MeetingRow({ meeting }: { meeting: MeetingListItem }) {
  const t = useTranslations('meetings');
  const format = useFormatter();
  const copy = useCopyLink();
  const start = new Date(meeting.scheduledStartAt);
  const end = new Date(meeting.scheduledEndAt);
  const joinable = canJoinNow(meeting, meeting.isHost);
  const hostName = meeting.host.name ?? meeting.host.email ?? '—';

  return (
    <li className="border-border hover:bg-muted/40 flex items-center gap-3 border-b px-3 py-3.5 last:border-b-0 sm:gap-5 sm:px-5">
      <div className="w-[4.5rem] shrink-0 text-end tabular-nums sm:w-24">
        <p className="text-foreground text-sm font-semibold sm:text-base">
          {format.dateTime(start, { hour: 'numeric', minute: '2-digit' })}
        </p>
        <p className="text-muted-foreground text-xs">
          {format.dateTime(end, { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
      <span className="bg-accent-blue/70 h-10 w-1 shrink-0 rounded-full" aria-hidden="true" />
      <Link
        href={`/meetings/${meeting.slug}`}
        className="focus-visible:ring-ring min-w-0 flex-1 space-y-1 focus-visible:outline-none focus-visible:ring-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium sm:text-base">
            {meeting.title}
          </span>
          {meeting.status === 'cancelled' ? (
            <Badge variant="destructive" size="sm">
              {t('status.cancelled')}
            </Badge>
          ) : null}
          {meeting.status === 'ended' ? (
            <Badge variant="muted" size="sm">
              {t('status.ended')}
            </Badge>
          ) : null}
          {meeting.isRecurring ? (
            <Repeat
              className="text-muted-foreground h-3.5 w-3.5 shrink-0"
              aria-label={t('recurring')}
            />
          ) : null}
        </div>
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <PersonAvatar name={hostName} className="h-5 w-5 text-[9px]" />
          <span className="truncate">{t('hostedBy', { name: hostName })}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {meeting.participantCount}
            <span className="sr-only">
              {t('participantCount', { count: meeting.participantCount })}
            </span>
          </span>
        </p>
      </Link>
      {meeting.status === 'scheduled' ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full max-sm:hidden"
          aria-label={t('copyLink')}
          onClick={() => void copy(meeting.slug)}
        >
          <Link2 aria-hidden="true" />
        </Button>
      ) : null}
      {joinable ? (
        <Button asChild size="sm" className={cn(CTA_BLUE, 'h-10 shrink-0 px-4 font-semibold')}>
          <Link href={`/meet/${meeting.slug}`}>
            <Video aria-hidden="true" />
            {meeting.isHost && meeting.status === 'scheduled' ? t('start') : t('join')}
          </Link>
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="h-10 shrink-0 max-sm:hidden">
          <Link href={`/meetings/${meeting.slug}`}>{t('viewDetails')}</Link>
        </Button>
      )}
    </li>
  );
}

function DayHeading({ groupKey, date }: { groupKey: string; date: Date }) {
  const t = useTranslations('meetings');
  const format = useFormatter();
  const label =
    groupKey === 'today'
      ? t('today')
      : groupKey === 'tomorrow'
        ? t('tomorrow')
        : format.dateTime(date, { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <h3 className="bg-muted/40 text-muted-foreground border-border border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide sm:px-5">
      {groupKey === 'today' || groupKey === 'tomorrow' ? (
        <>
          {label}
          <span className="ms-2 font-normal normal-case">
            {format.dateTime(date, { month: 'short', day: 'numeric' })}
          </span>
        </>
      ) : (
        label
      )}
    </h3>
  );
}

export function MeetingsPageClient() {
  const t = useTranslations('meetings');
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const list = useMeetings(currentOrganizationId, tab);
  const live = useMeetings(currentOrganizationId, 'live');
  const create = useCreateMeeting();

  const startInstant = () => {
    if (!currentOrganizationId) return;
    create.mutate(
      {
        organizationId: currentOrganizationId,
        title: t('instantTitle'),
        mode: 'instant',
        durationMinutes: 60,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        participantUserIds: [],
        guests: [],
      },
      {
        onSuccess: ({ meeting }) => router.push(`/meet/${meeting.slug}`),
        onError: () => toast({ title: t('errors.createFailed'), variant: 'destructive' }),
      }
    );
  };

  const joinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = extractMeetingSlug(code);
    if (!slug) return setCodeError(true);
    router.push(`/meet/${slug}`);
  };

  const liveMeetings = live.data?.meetings ?? [];
  const groups = useMemo(
    () => (tab === 'upcoming' ? groupByDay(list.data?.meetings ?? []) : []),
    [list.data, tab]
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/meetings/analytics">
              <BarChart3 aria-hidden="true" />
              {t('analytics')}
            </Link>
          </Button>
        }
      />

      <section
        aria-label={t('startOrJoin')}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className={cn(CTA_BLUE, 'h-12 gap-2 px-6 text-base font-semibold')}
              disabled={create.isPending || !currentOrganizationId}
            >
              <Video aria-hidden="true" />
              {t('newMeeting')}
              <ChevronDown className="!h-4 !w-4 opacity-80" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem className="gap-3 py-2.5" onSelect={startInstant}>
              <Video className="h-4 w-4" aria-hidden="true" />
              {t('newInstant')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-3 py-2.5" onSelect={() => setScheduleOpen(true)}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              {t('newSchedule')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <form onSubmit={joinByCode} className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <div className="relative min-w-0 flex-1">
            <Keyboard
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(false);
              }}
              placeholder={t('joinCodePlaceholder')}
              aria-label={t('joinCodePlaceholder')}
              aria-invalid={codeError}
              className="h-12 ps-9 text-base"
            />
          </div>
          <Button
            type="submit"
            variant="ghost"
            className="text-accent-blue h-12 px-4 font-semibold"
            disabled={!code.trim()}
          >
            {t('joinWithCode')}
          </Button>
        </form>
      </section>
      {codeError ? (
        <p role="alert" className="text-destructive -mt-3 text-sm">
          {t('joinCodeInvalid')}
        </p>
      ) : null}

      {liveMeetings.length > 0 ? (
        <section aria-label={t('liveNow')} className="space-y-3">
          <h2 className="text-sm font-semibold">{t('liveNow')}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {liveMeetings.map((m) => (
              <LiveCard key={m.slug} meeting={m} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="upcoming">{t('tabs.upcoming')}</TabsTrigger>
            <TabsTrigger value="past">{t('tabs.past')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="border-border bg-card overflow-hidden rounded-lg border">
          {list.isLoading || !currentOrganizationId ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-muted-foreground text-sm">{t('errors.loadFailed')}</p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                {t('retry')}
              </Button>
            </div>
          ) : list.data && list.data.meetings.length > 0 ? (
            tab === 'upcoming' ? (
              groups.map((g) => (
                <div key={g.key}>
                  <DayHeading groupKey={g.key} date={g.date} />
                  <ul>
                    {g.items.map((m) => (
                      <MeetingRow key={m.slug} meeting={m} />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <ul>
                {list.data.meetings.map((m) => (
                  <MeetingRow key={m.slug} meeting={m} />
                ))}
              </ul>
            )
          ) : (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <span
                className="bg-muted text-muted-foreground flex h-14 w-14 items-center justify-center rounded-full"
                aria-hidden="true"
              >
                <CalendarX2 className="h-6 w-6" />
              </span>
              <p className="text-foreground text-base font-medium">{t(`empty.${tab}.title`)}</p>
              <p className="text-muted-foreground max-w-sm text-sm">{t(`empty.${tab}.body`)}</p>
              {tab === 'upcoming' ? (
                <Button
                  className={cn(CTA_BLUE, 'mt-1')}
                  onClick={startInstant}
                  disabled={create.isPending}
                >
                  <Video aria-hidden="true" />
                  {t('newInstant')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        organizationId={currentOrganizationId}
      />
    </div>
  );
}
