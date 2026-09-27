'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

function InitiativeStatusBadge({ status }: { status: string }) {
  const t = useTranslations('planning');
  const tProjects = useTranslations('pagesProjects');
  const labelKey: Record<string, string> = {
    planned: 'status_planned',
    paused: 'status_paused',
    complete: 'status_completed',
    cancelled: 'status_cancelled',
  };
  const tone: Record<string, string> = {
    planned: 'bg-muted text-muted-foreground',
    active: 'bg-accent-blue/10 text-accent-blue',
    paused: 'bg-accent-amber/10 text-accent-amber',
    complete: 'bg-accent-emerald/10 text-accent-emerald',
    cancelled: 'bg-accent-rose/10 text-accent-rose',
  };

  return (
    <Badge
      variant="outline"
      className={cn('uppercase tracking-wider', tone[status] ?? tone.planned)}
    >
      {status === 'active' ? tProjects('statusActive') : t(labelKey[status] ?? 'status_planned')}
    </Badge>
  );
}

function InitiativeHealthBadge({ status }: { status: string }) {
  const t = useTranslations('pagesHome');
  const labelKey: Record<string, string> = {
    green: 'initiative_detail_status_green',
    yellow: 'initiative_detail_status_yellow',
    red: 'initiative_detail_status_red',
  };
  const tone: Record<string, string> = {
    green: 'bg-accent-emerald/10 text-accent-emerald',
    yellow: 'bg-accent-amber/10 text-accent-amber',
    red: 'bg-accent-rose/10 text-accent-rose',
  };

  return (
    <Badge
      variant="outline"
      className={cn('uppercase tracking-wider', tone[status] ?? tone.yellow)}
    >
      {t(labelKey[status] ?? 'initiative_detail_status_yellow')}
    </Badge>
  );
}

interface InitiativeDetail {
  initiative: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    targetDate: string | null;
    color: string | null;
    workspaceId: string;
  };
  projects: Array<{
    projectId: string;
    projectName: string | null;
    projectKey: string | null;
    projectStatus: string | null;
  }>;
  children: Array<{ id: string; name: string; status: string }>;
}

interface InitiativeUpdate {
  id: string;
  status: string;
  summary: string;
  blockers: string | null;
  nextSteps: string | null;
  weekOf: string;
  createdAt: string;
  authorName: string | null;
  authorImage: string | null;
}

interface RollUpResponse {
  done: number;
  total: number;
  percent: number;
  projectCount: number;
  perProject: Array<{
    projectId: string;
    projectName: string | null;
    projectKey: string | null;
    done: number;
    total: number;
    percent: number;
  }>;
}

export function InitiativeDetailClient({ initiativeId }: { initiativeId: string }) {
  const t = useTranslations('pagesHome');
  const errorT = useTranslations('componentErrors.initiatives');
  const queryClient = useQueryClient();

  const {
    data: detail,
    error: detailError,
    isLoading,
  } = useQuery<InitiativeDetail>({
    queryKey: ['initiative', initiativeId],
    queryFn: async () => {
      const res = await fetch(`/api/initiatives/${initiativeId}`);
      if (!res.ok) {
        const message =
          res.status === 401 || res.status === 403
            ? t('toast_access_denied_description')
            : t('initiative_detail_error_load');
        throw new Error(message);
      }
      return res.json();
    },
  });

  const { data: rollup } = useQuery<RollUpResponse>({
    queryKey: ['initiative-rollup', initiativeId],
    queryFn: async () => {
      const res = await fetch(`/api/initiatives/${initiativeId}/roll-up`);
      if (!res.ok) throw new Error(errorT('loadRollup'));
      return res.json();
    },
  });

  const { data: updates } = useQuery<{ updates: InitiativeUpdate[] }>({
    queryKey: ['initiative-updates', initiativeId],
    queryFn: async () => {
      const res = await fetch(`/api/initiatives/${initiativeId}/updates`);
      if (!res.ok) throw new Error(errorT('loadUpdates'));
      return res.json();
    },
  });

  // Post-update form state
  const [status, setStatus] = useState<'green' | 'yellow' | 'red'>('green');
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [nextSteps, setNextSteps] = useState('');

  const postUpdate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/initiatives/${initiativeId}/updates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, summary, blockers, nextSteps }),
      });
      if (!res.ok) throw new Error(t('initiative_detail_error_post'));
      return res.json();
    },
    onSuccess: () => {
      setSummary('');
      setBlockers('');
      setNextSteps('');
      queryClient.invalidateQueries({ queryKey: ['initiative-updates', initiativeId] });
    },
  });

  if (isLoading) {
    return (
      <PageFrame contentClassName="flex min-h-[50vh] max-w-6xl items-center justify-center">
        <h1 className="sr-only">{t('initiative_detail_kicker')}</h1>
        <div className="text-muted-foreground flex items-center text-sm">
          <Loader2 className="me-2 h-4 w-4 animate-spin" />
          {t('initiative_detail_loading')}
        </div>
      </PageFrame>
    );
  }

  if (detailError || !detail) {
    return (
      <PageFrame contentClassName="flex min-h-[50vh] max-w-6xl items-center justify-center">
        <h1 className="sr-only">{t('initiative_detail_kicker')}</h1>
        <Alert className="max-w-lg">
          <AlertTitle>{t('toast_access_denied_title')}</AlertTitle>
          <AlertDescription>
            {detailError instanceof Error ? detailError.message : t('initiative_detail_error_load')}
          </AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame className="animate-fade-in" contentClassName="max-w-7xl">
      <Link
        href="/initiatives"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mb-1 inline-flex min-h-8 items-center gap-1 rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <ChevronLeft className="h-3 w-3 rtl:rotate-180" />
        {t('initiative_detail_all_initiatives')}
      </Link>
      <PageHeader
        kicker={t('initiative_detail_kicker')}
        title={detail.initiative.name}
        description={detail.initiative.description}
        actions={<InitiativeStatusBadge status={detail.initiative.status} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        {/* Roll-up + member projects */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('initiative_detail_rollup')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Progress
                  value={rollup?.percent ?? 0}
                  className="h-3 flex-1"
                  aria-label={t('initiative_detail_rollup')}
                />
                <div className="w-16 text-right font-mono text-sm tabular-nums">
                  {rollup?.percent ?? 0}%
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {rollup
                  ? t('initiative_detail_rollup_summary', {
                      done: rollup.done,
                      total: rollup.total,
                      count: rollup.projectCount,
                    })
                  : t('initiative_detail_no_data')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('initiative_detail_member_projects')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {detail.projects.length === 0 ? (
                <div className="text-muted-foreground px-6 py-8 text-center text-sm">
                  {t('initiative_detail_no_projects')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-border bg-surface border-b">
                    <tr className="text-muted-foreground text-start text-[10px] uppercase tracking-wider">
                      <th className="px-4 py-2">{t('initiative_detail_col_key')}</th>
                      <th className="px-4 py-2">{t('initiative_detail_col_project')}</th>
                      <th className="px-4 py-2">{t('initiative_detail_col_issues')}</th>
                      <th className="px-4 py-2 text-end">{t('initiative_detail_col_progress')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.projects.map((p) => {
                      const stats = rollup?.perProject.find((r) => r.projectId === p.projectId);
                      return (
                        <tr key={p.projectId} className="border-border border-b last:border-b-0">
                          <td className="text-muted-foreground px-4 py-2 font-mono text-xs">
                            {p.projectKey ?? '—'}
                          </td>
                          <td className="px-4 py-2">{p.projectName ?? p.projectId}</td>
                          <td className="text-muted-foreground px-4 py-2 text-xs">
                            {stats ? `${stats.done}/${stats.total}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-end font-mono text-xs tabular-nums">
                            {stats ? `${stats.percent}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {detail.children.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('initiative_detail_sub_initiatives')}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  {detail.children.map((child) => (
                    <li
                      key={child.id}
                      className="border-border flex items-center justify-between border-b px-4 py-2 last:border-b-0"
                    >
                      <Link
                        href={`/initiatives/${child.id}`}
                        className="text-foreground hover:text-primary text-sm"
                      >
                        {child.name}
                      </Link>
                      <InitiativeStatusBadge status={child.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Updates feed + post-update form */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('initiative_detail_post_update')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="initiative-update-status" className="kicker text-[10px]">
                  {t('initiative_detail_status')}
                </label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as 'green' | 'yellow' | 'red')}
                >
                  <SelectTrigger id="initiative-update-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="green">{t('initiative_detail_status_green')}</SelectItem>
                    <SelectItem value="yellow">{t('initiative_detail_status_yellow')}</SelectItem>
                    <SelectItem value="red">{t('initiative_detail_status_red')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="kicker text-[10px]">{t('initiative_detail_summary')}</label>
                <Textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder={t('initiative_detail_summary_placeholder')}
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <label className="kicker text-[10px]">{t('initiative_detail_blockers')}</label>
                <Input
                  value={blockers}
                  onChange={(e) => setBlockers(e.target.value)}
                  placeholder={t('initiative_detail_blockers_placeholder')}
                />
              </div>
              <div className="space-y-1">
                <label className="kicker text-[10px]">{t('initiative_detail_next_steps')}</label>
                <Input
                  value={nextSteps}
                  onChange={(e) => setNextSteps(e.target.value)}
                  placeholder={t('initiative_detail_next_steps_placeholder')}
                />
              </div>
              <Button
                onClick={() => postUpdate.mutate()}
                disabled={!summary || postUpdate.isPending}
                className="w-full"
              >
                {postUpdate.isPending ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-2 h-3 w-3" />
                )}
                {t('initiative_detail_post_update')}
              </Button>
              {postUpdate.error ? (
                <p className="text-destructive text-xs">{t('initiative_detail_error_post')}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('initiative_detail_updates')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {!updates?.updates || updates.updates.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('initiative_detail_no_updates')}</p>
              ) : (
                updates.updates.map((u) => (
                  <div key={u.id} className="border-border bg-surface rounded-md border p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-foreground text-xs font-medium">
                        {u.authorName ?? t('initiative_detail_anonymous')}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <InitiativeHealthBadge status={u.status} />
                        <span className="text-muted-foreground text-[10px]">{u.weekOf}</span>
                      </div>
                    </div>
                    <p className="text-sm">{u.summary}</p>
                    {u.blockers ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        <span className="font-medium">{t('initiative_detail_blockers_label')}</span>{' '}
                        {u.blockers}
                      </p>
                    ) : null}
                    {u.nextSteps ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        <span className="font-medium">{t('initiative_detail_next_label')}</span>{' '}
                        {u.nextSteps}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}
