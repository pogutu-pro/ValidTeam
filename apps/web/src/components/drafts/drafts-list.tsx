'use client';

import {
  AlertCircle,
  ArrowUpRight,
  CheckSquare,
  FileText,
  Inbox,
  MessageSquare,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, type ComponentType } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { useDrafts, type Draft } from '@/lib/drafts/use-drafts';
import { useProjects } from '@/lib/hooks/use-projects';
import { useOrganization } from '@/lib/hooks/use-organization';
import { cn } from '@/lib/utils';

type DraftFilter = 'all' | Draft['type'];
type SortKey = 'updated' | 'created';

const TYPE_META: Record<
  Draft['type'],
  { labelKey: string; icon: ComponentType<{ className?: string }> }
> = {
  work_item: { labelKey: 'drafts.types.work_item', icon: CheckSquare },
  page: { labelKey: 'drafts.types.page', icon: FileText },
  comment: { labelKey: 'drafts.types.comment', icon: MessageSquare },
};

function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function DraftsList() {
  const t = useTranslations('workspaceTools');
  const formatter = useFormatter();
  const { drafts, updateDraft, removeDraft, promoteDraft, isLoading, isError, error } = useDrafts();
  const [filter, setFilter] = useState<DraftFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { currentOrganizationId, currentTeamId } = useOrganization();
  const { data: projectsForCreate } = useProjects({
    organizationId: currentOrganizationId,
    teamId: currentTeamId,
  });
  const firstProjectId = projectsForCreate?.[0]?.id ?? null;

  const counts = useMemo(() => {
    const base = { all: drafts.length, work_item: 0, page: 0, comment: 0 };
    for (const d of drafts) base[d.type] += 1;
    return base;
  }, [drafts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = drafts.filter((d) => {
      if (filter !== 'all' && d.type !== filter) return false;
      if (!q) return true;
      return d.title.toLowerCase().includes(q) || (d.body ?? '').toLowerCase().includes(q);
    });
    const sorted = [...filtered].sort((a, b) => {
      const key = sort === 'updated' ? 'updatedAt' : 'createdAt';
      return b[key] - a[key];
    });
    return sorted;
  }, [drafts, filter, query, sort]);

  const beginEdit = (draft: Draft) => {
    setEditingId(draft.id);
    setEditTitle(draft.title);
  };

  const commitEdit = () => {
    if (editingId) {
      void updateDraft(editingId, {
        title: editTitle.trim() || t('drafts.untitled'),
      });
    }
    setEditingId(null);
    setEditTitle('');
  };

  return (
    <div className="space-y-4">
      <div className="surface-inset flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="scrollbar-none text-muted-foreground flex min-h-10 w-full items-center overflow-x-auto rounded-md sm:w-auto">
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
            className={cn(
              'focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset',
              filter === 'all' && 'bg-background text-foreground shadow-xs'
            )}
          >
            {t('drafts.tabs.all')}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {counts.all}
            </Badge>
          </button>
          <button
            type="button"
            aria-pressed={filter === 'work_item'}
            onClick={() => setFilter('work_item')}
            className={cn(
              'focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset',
              filter === 'work_item' && 'bg-background text-foreground shadow-xs'
            )}
          >
            {t('drafts.tabs.work_item')}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {counts.work_item}
            </Badge>
          </button>
          <button
            type="button"
            aria-pressed={filter === 'page'}
            onClick={() => setFilter('page')}
            className={cn(
              'focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset',
              filter === 'page' && 'bg-background text-foreground shadow-xs'
            )}
          >
            {t('drafts.tabs.page')}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {counts.page}
            </Badge>
          </button>
          <button
            type="button"
            aria-pressed={filter === 'comment'}
            onClick={() => setFilter('comment')}
            className={cn(
              'focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset',
              filter === 'comment' && 'bg-background text-foreground shadow-xs'
            )}
          >
            {t('drafts.tabs.comment')}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {counts.comment}
            </Badge>
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-2 min-[390px]:flex-row min-[390px]:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('drafts.searchPlaceholder')}
              className="w-full ps-8 min-[390px]:w-52 sm:w-64"
              aria-label={t('drafts.searchAria')}
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger
              className="w-full min-[390px]:w-[140px]"
              aria-label={t('drafts.sortAria')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">{t('drafts.sort.updated')}</SelectItem>
              <SelectItem value="created">{t('drafts.sort.created')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={error?.message ?? t('drafts.loadFailed')} />
      ) : visible.length === 0 ? (
        <EmptyState
          hasAny={drafts.length > 0}
          firstProjectId={firstProjectId}
          onCreate={() => setIsCreateOpen(true)}
        />
      ) : (
        <ul className="surface-card divide-y overflow-hidden shadow-none">
          {visible.map((draft) => {
            const meta = TYPE_META[draft.type];
            const Icon = meta.icon;
            const isEditing = editingId === draft.id;
            return (
              <li
                key={draft.id}
                className="hover:bg-accent/40 group flex items-start gap-3 p-3 transition-colors"
              >
                <div className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <Input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      className="h-8"
                      aria-label={t('drafts.editTitleAria')}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {draft.title || t('drafts.untitled')}
                      </p>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {t(meta.labelKey)}
                      </Badge>
                    </div>
                  )}
                  {draft.body ? (
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {truncate(draft.body, 80)}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {t('drafts.updatedAt', {
                      time: formatter.relativeTime(new Date(draft.updatedAt)),
                    })}
                  </p>
                </div>

                <div
                  className={cn(
                    'flex shrink-0 items-center gap-1 opacity-0 transition-opacity',
                    'focus-within:opacity-100 group-hover:opacity-100'
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => beginEdit(draft)}
                    aria-label={t('drafts.editAria')}
                    title={t('drafts.editTitle')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      void promoteDraft(draft.id);
                    }}
                    aria-label={t('drafts.promoteAria')}
                    title={t('drafts.promoteTitle')}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive size-8"
                    onClick={() => {
                      void removeDraft(draft.id);
                    }}
                    aria-label={t('drafts.deleteAria')}
                    title={t('drafts.deleteTitle')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {firstProjectId ? (
        <CreateIssueModal
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          projectId={firstProjectId}
        />
      ) : null}
    </div>
  );
}

function LoadingState() {
  const t = useTranslations('workspaceTools');
  return (
    <ul
      className="surface-card divide-y overflow-hidden shadow-none"
      aria-busy="true"
      aria-label={t('drafts.loadingAria')}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 p-3">
          <div className="bg-muted mt-0.5 size-8 shrink-0 animate-pulse rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-2/3 animate-pulse rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ message }: { message: string }) {
  const t = useTranslations('workspaceTools');
  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
        <AlertCircle className="size-7" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{t('drafts.errorTitle')}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{message}</p>
    </div>
  );
}

function EmptyState({
  hasAny,
  firstProjectId,
  onCreate,
}: {
  hasAny: boolean;
  firstProjectId: string | null;
  onCreate: () => void;
}) {
  const t = useTranslations('workspaceTools');
  return (
    <div className="bg-card/50 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        <Inbox className="size-7" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{t('drafts.emptyTitle')}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {hasAny ? t('drafts.emptyFiltered') : t('drafts.emptyDescription')}
      </p>
      <div className="mt-5">
        {firstProjectId ? (
          <Button onClick={onCreate}>{t('drafts.createWorkItem')}</Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/projects">{t('drafts.createProjectFirst')}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
