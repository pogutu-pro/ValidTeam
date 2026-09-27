'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bot, Check, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useOrganizationAgentSettings } from '@/lib/hooks/use-agents';
import { formatAgentRunKind } from '@/lib/agents/run-kind-labels';
import { formatAgentRunDisplayText, formatAgentRunStatus } from '@/lib/agents/i18n';
import { cn } from '@/lib/utils';

type ApprovalRequest = {
  id: string;
  status: 'pending' | 'executing' | 'approved' | 'rejected' | 'expired' | 'failed';
};

export function AgentAttentionWidget({
  organizationId,
  onPendingApprovalCountChange,
}: {
  organizationId: string | null;
  onPendingApprovalCountChange?: (count: number) => void;
}) {
  const t = useTranslations('settingsConfig');
  const tActions = useTranslations('actions');
  const tNav = useTranslations('nav');
  const tRunKind = useTranslations('agentRunKinds');
  const formatter = useFormatter();
  const agentQuery = useOrganizationAgentSettings(organizationId);
  const canReview = agentQuery.data?.access.canManage ?? false;

  const approvalsQuery = useQuery<{ approvals: ApprovalRequest[] }>({
    queryKey: ['agent-approvals', organizationId, 'pending'],
    queryFn: async () => {
      const response = await fetch(
        `/api/agent-approvals?organizationId=${encodeURIComponent(organizationId ?? '')}&status=pending`
      );
      const payload = await response
        .json()
        .catch(() => ({ error: t('agentGovernance.queueLoadFailed') }));
      if (!response.ok) {
        throw new Error(payload.error || t('agentGovernance.queueLoadFailed'));
      }
      return payload as { approvals: ApprovalRequest[] };
    },
    enabled: !!organizationId && canReview,
  });

  const pendingApprovalCount =
    canReview && !approvalsQuery.isError ? (approvalsQuery.data?.approvals.length ?? 0) : 0;

  useEffect(() => {
    onPendingApprovalCountChange?.(pendingApprovalCount);
  }, [onPendingApprovalCountChange, pendingApprovalCount]);

  if (!organizationId) return null;

  if (agentQuery.isLoading) {
    return (
      <section className="surface-card min-w-0 overflow-hidden" aria-busy="true">
        <div className="border-border flex min-h-12 items-center gap-2 border-b px-4">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          <span className="text-muted-foreground text-sm">{t('orgAi.loading')}</span>
        </div>
        <div className="grid grid-cols-2">
          <span className="bg-muted/60 h-16 animate-pulse" />
          <span className="bg-muted/60 border-border h-16 animate-pulse border-s" />
        </div>
      </section>
    );
  }

  const data = agentQuery.data;
  if (!data?.access.canView) return null;

  const pendingCount = canReview && !approvalsQuery.isError ? pendingApprovalCount : null;
  const recentRuns = data.recentRuns.slice(0, 3);

  return (
    <section
      className={cn(
        'surface-card min-w-0 overflow-hidden',
        pendingCount && 'border-accent-amber/40'
      )}
      aria-labelledby="agent-attention-heading"
    >
      <div className="border-border flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
          <h2 id="agent-attention-heading" className="truncate text-sm font-semibold">
            {tNav('ai_agents')}
          </h2>
          {pendingCount ? (
            <span className="chip-amber shrink-0">{t('orgAi.needs_review')}</span>
          ) : null}
        </div>
        {data.access.canManage ? (
          <Link
            href="/settings?tab=ai-agents#agent-governance"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {tActions('view_all')}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <dl className="border-border grid grid-cols-2 border-b">
        <div className="min-w-0 px-4 py-3">
          <dt className="text-muted-foreground truncate text-[10px] font-medium uppercase tracking-[0.055em]">
            {t('orgAi.stat_total_runs')}
          </dt>
          <dd className={cn('mt-1 text-lg font-semibold tabular-nums', 'text-foreground')}>
            {data.runtimeSummary.totalRuns}
          </dd>
        </div>
        <div className="border-border min-w-0 border-s px-4 py-3">
          <dt className="text-muted-foreground truncate text-[10px] font-medium uppercase tracking-[0.055em]">
            {t('orgAi.stat_running_now')}
          </dt>
          <dd className="text-foreground mt-1 text-lg font-semibold tabular-nums">
            {data.runtimeSummary.runningRuns}
          </dd>
        </div>
      </dl>

      {recentRuns.length === 0 ? (
        <div className="text-muted-foreground flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-5 text-center text-xs">
          <Check className="h-4 w-4" aria-hidden="true" />
          <p>{t('orgAi.no_runs')}</p>
        </div>
      ) : (
        <ol className="divide-border divide-y">
          {recentRuns.map((run) => {
            const displaySummary = formatAgentRunDisplayText(t, run.summary);
            return (
              <li key={run.id} className="min-w-0 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'status-dot shrink-0',
                      run.status === 'failed'
                        ? 'status-danger'
                        : run.status === 'running' || run.status === 'pending'
                          ? 'status-live'
                          : 'status-idle'
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">
                    {formatAgentRunKind(run.kind, tRunKind)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatAgentRunStatus(t, run.status)}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 ps-3.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate">
                    {displaySummary || run.projectName || t('orgAi.unknown_project')}
                  </span>
                  <time className="shrink-0 tabular-nums" dateTime={run.createdAt}>
                    {formatter.relativeTime(new Date(run.createdAt))}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
