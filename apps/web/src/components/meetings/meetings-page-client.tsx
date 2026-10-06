'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { BarChart3, CalendarPlus, Repeat, Users, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useOrganization } from '@/lib/hooks/use-organization';
import {
  useCreateMeeting,
  useMeetings,
  type MeetingListItem,
  type MeetingScope,
} from '@/lib/hooks/use-meetings';
import { canJoinNow, statusVariant } from './meeting-format';
import { ScheduleMeetingDialog } from './schedule-meeting-dialog';

function MeetingRow({ meeting }: { meeting: MeetingListItem }) {
  const t = useTranslations('meetings');
  const format = useFormatter();
  const start = new Date(meeting.scheduledStartAt);
  const end = new Date(meeting.scheduledEndAt);
  const joinable = canJoinNow(meeting, meeting.isHost);

  return (
    <li className="border-border hover:bg-muted/40 flex flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
      <Link
        href={`/meetings/${meeting.slug}`}
        className="focus-visible:ring-ring min-w-0 flex-1 space-y-1 focus-visible:outline-none focus-visible:ring-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">{meeting.title}</span>
          <Badge variant={statusVariant[meeting.status]} size="sm">
            {t(`status.${meeting.status}`)}
          </Badge>
          {meeting.isRecurring ? (
            <Repeat
              className="text-muted-foreground h-3.5 w-3.5 shrink-0"
              aria-label={t('recurring')}
            />
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {format.dateTime(start, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
          {format.dateTime(start, { hour: 'numeric', minute: '2-digit' })} –{' '}
          {format.dateTime(end, { hour: 'numeric', minute: '2-digit' })}
        </p>
        <p className="text-muted-foreground flex items-center gap-3 text-xs">
          <span>{t('hostedBy', { name: meeting.host.name ?? meeting.host.email ?? '—' })}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {t('participantCount', { count: meeting.participantCount })}
          </span>
        </p>
      </Link>
      {joinable ? (
        <Button asChild size="sm" variant={meeting.status === 'live' ? 'default' : 'outline'}>
          <Link href={`/meet/${meeting.slug}`}>
            <Video aria-hidden="true" />
            {meeting.isHost && meeting.status === 'scheduled' ? t('start') : t('join')}
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

export function MeetingsPageClient() {
  const t = useTranslations('meetings');
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const [scope, setScope] = useState<MeetingScope>('upcoming');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useMeetings(currentOrganizationId, scope);
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

  const liveCount = live.data?.meetings.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/meetings/analytics">
                <BarChart3 aria-hidden="true" />
                {t('analytics')}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setScheduleOpen(true)}>
              <CalendarPlus aria-hidden="true" />
              {t('schedule')}
            </Button>
            <Button onClick={startInstant} disabled={create.isPending || !currentOrganizationId}>
              <Video aria-hidden="true" />
              {t('startMeeting')}
            </Button>
          </>
        }
      />

      <Tabs value={scope} onValueChange={(v) => setScope(v as MeetingScope)}>
        <TabsList>
          <TabsTrigger value="upcoming">{t('tabs.upcoming')}</TabsTrigger>
          <TabsTrigger value="live">
            {t('tabs.live')}
            {liveCount > 0 ? (
              <span className="bg-accent-emerald/15 text-accent-emerald ms-1.5 rounded-sm px-1.5 text-[10px] font-semibold tabular-nums">
                {liveCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="past">{t('tabs.past')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {isLoading || !currentOrganizationId ? (
          <div className="space-y-2 p-4" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-muted-foreground text-sm">{t('errors.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : data && data.meetings.length > 0 ? (
          <ul>
            {data.meetings.map((m) => (
              <MeetingRow key={m.slug} meeting={m} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-foreground text-sm font-medium">{t(`empty.${scope}.title`)}</p>
            <p className="text-muted-foreground max-w-sm text-xs">{t(`empty.${scope}.body`)}</p>
            {scope !== 'past' ? (
              <Button size="sm" onClick={startInstant} disabled={create.isPending}>
                <Video aria-hidden="true" />
                {t('startMeeting')}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <ScheduleMeetingDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        organizationId={currentOrganizationId}
      />
    </div>
  );
}
