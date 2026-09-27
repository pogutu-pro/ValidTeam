'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';
import { IssueDetailModal } from '@/components/issues/issue-detail-modal';
import { Inbox, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { MyIssuesLoadingShell } from './my-issues-loading-shell';
import { isApiPermissionError, throwApiResponseError } from '@/lib/client-api-errors';

interface Issue {
  id: string;
  key: string;
  title: string;
  priority: string;
  statusId: string;
  projectId: string;
  estimate?: number;
  status: {
    name: string;
    category: string;
    color: string;
  };
  project: {
    key: string;
    name: string;
  };
  updatedAt?: string;
  createdAt?: string;
}

const priorityClass: Record<string, string> = {
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  critical: 'priority-critical',
};

const statusChipClass: Record<string, string> = {
  backlog: 'chip',
  todo: 'chip',
  in_progress: 'chip-blue',
  in_review: 'chip-violet',
  done: 'chip-emerald',
  blocked: 'chip-rose',
  pending: 'chip-amber',
};

type ScopeFilter = 'assigned' | 'created' | 'subscribed' | 'mentioned';

const scopeOptions: { value: ScopeFilter; labelKey: string }[] = [
  { value: 'assigned', labelKey: 'assigned_to_me' },
  { value: 'created', labelKey: 'created_by_me' },
  { value: 'subscribed', labelKey: 'subscribed' },
  { value: 'mentioned', labelKey: 'mentioned' },
];

function parseScope(value: string | null): ScopeFilter {
  if (value === 'created' || value === 'subscribed' || value === 'mentioned') {
    return value;
  }
  return 'assigned';
}

function formatRelativeDate(input?: string): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.round(days / 365);
  return `${years}y`;
}

export function MyIssuesClient() {
  const t = useTranslations('pagesHome');
  const tNav = useTranslations('nav');
  const tIssues = useTranslations('issuesViews');
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialScope = parseScope(searchParams.get('view'));
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>(initialScope);

  useEffect(() => {
    setScope(parseScope(searchParams.get('view')));
  }, [searchParams]);

  const handleScopeChange = (next: ScopeFilter) => {
    setScope(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const {
    data: myIssues,
    error,
    isLoading,
  } = useQuery<Issue[]>({
    queryKey: ['my-issues', session?.user?.id, scope],
    queryFn: async () => {
      const params = new URLSearchParams({ view: scope });
      const response = await fetch(`/api/issues/my-issues?${params.toString()}`);
      if (!response.ok) await throwApiResponseError(response, tIssues('loadFailed'));
      const data = await response.json();
      return data.issues || [];
    },
    enabled: !!session?.user?.id,
  });

  const filteredIssues = (myIssues ?? []).filter((issue) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return issue.title.toLowerCase().includes(query) || issue.key.toLowerCase().includes(query);
  });

  if (isLoading) {
    return <MyIssuesLoadingShell title={tNav('my_issues')} />;
  }

  if (error) {
    const message = isApiPermissionError(error)
      ? t('toast_access_denied_description')
      : tIssues('loadFailed');
    return (
      <div className="bg-background flex h-full items-center justify-center p-6">
        <div className="surface-card max-w-md space-y-2 p-6 text-center">
          <p className="text-foreground text-sm font-medium">{tIssues('loadFailed')}</p>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageFrame contentClassName="max-w-6xl">
        <PageHeader
          kicker={t('my_issues_kicker')}
          title={tNav('my_issues')}
          description={t('my_issues_count', { count: filteredIssues.length })}
          actions={
            <div className="relative w-full sm:w-72">
              <Search className="text-muted-foreground absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder={t('my_issues_search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 ps-9"
              />
            </div>
          }
        />

        {/* Filter toolbar: single simple scope switch */}
        <div className="surface-inset shrink-0 p-1">
          <div
            className="scrollbar-none flex items-center gap-1 overflow-x-auto whitespace-nowrap"
            role="toolbar"
            aria-label={tNav('my_issues')}
          >
            {scopeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={scope === option.value}
                onClick={() => handleScopeChange(option.value)}
                className={cn(
                  'ease-snap focus-visible:ring-ring min-h-9 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-[color,background-color,box-shadow,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-inset',
                  scope === option.value
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                {tNav(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-64">
          {filteredIssues.length === 0 ? (
            <div className="animate-fade-up flex h-full items-center justify-center">
              <div className="text-center">
                <Inbox className="text-muted-foreground mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground text-sm">
                  {searchQuery
                    ? t('my_issues_empty_search')
                    : scope === 'assigned'
                      ? t('my_issues_empty_assigned')
                      : scope === 'created'
                        ? t('my_issues_empty_created')
                        : scope === 'subscribed'
                          ? t('my_issues_empty_subscribed')
                          : t('my_issues_empty_mentioned')}
                </p>
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSearchQuery('')}
                  >
                    {t('my_issues_clear_search')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="animate-fade-up">
              <div className="surface-card overflow-hidden shadow-none">
                <ul className="stagger">
                  {filteredIssues.map((issue, idx) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      isLast={idx === filteredIssues.length - 1}
                      onClick={() => setSelectedIssueId(issue.id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </PageFrame>

      {selectedIssueId && (
        <IssueDetailModal
          issueId={selectedIssueId}
          open={!!selectedIssueId}
          onOpenChange={(open) => !open && setSelectedIssueId(null)}
        />
      )}
    </>
  );
}

function IssueRow({
  issue,
  isLast,
  onClick,
}: {
  issue: Issue;
  isLast: boolean;
  onClick: () => void;
}) {
  const pClass = priorityClass[issue.priority] ?? 'priority-medium';
  const chipClass = statusChipClass[issue.status.category] ?? 'chip';
  const updated = formatRelativeDate(issue.updatedAt ?? issue.createdAt);

  return (
    <li className={cn('relative', !isLast && 'border-border/60 border-b')}>
      {/* Left-edge priority indicator */}
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-0.5', pClass)} />
      <button
        type="button"
        onClick={onClick}
        className="row-interactive group flex min-h-11 w-full items-center gap-3 rounded-none pe-4 ps-4 text-start focus-visible:ring-2 focus-visible:ring-inset"
      >
        {/* Title (with inline key) */}
        <p className="text-foreground flex-1 truncate text-sm">
          <span className="text-muted-foreground me-2 font-mono text-xs">{issue.key}</span>
          {issue.title}
        </p>

        {/* Status chip */}
        <span className={cn('hidden shrink-0 sm:inline-flex', chipClass)}>{issue.status.name}</span>

        {/* Compact time */}
        {updated && (
          <span className="text-muted-foreground hidden w-10 shrink-0 text-end font-mono text-[11px] tabular-nums sm:inline">
            {updated}
          </span>
        )}
      </button>
    </li>
  );
}
