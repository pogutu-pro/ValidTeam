'use client';

import { use, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useIssues } from '@/lib/hooks/use-issues';
import { useSprints, useAssignIssueToSprint } from '@/lib/hooks/use-sprints';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { IssueDetailModal } from '@/components/issues/issue-detail-modal';
import { AiDraftIssueDialog } from '@/components/ai/ai-draft-issue-dialog';
import { useAiCapability } from '@/lib/hooks/use-ai-capability';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus,
  Timer,
  BookOpen,
  CheckSquare,
  Bug,
  Zap,
  FileText,
  Inbox,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BacklogLoadingShell } from './backlog-loading-shell';

const typeConfig: Record<string, { icon: React.ElementType; color: string }> = {
  story: { icon: BookOpen, color: 'text-accent-emerald' },
  task: { icon: CheckSquare, color: 'text-accent-blue' },
  bug: { icon: Bug, color: 'text-accent-rose' },
  epic: { icon: Zap, color: 'text-accent-violet' },
};

export default function BacklogPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const t = useTranslations('pagesProjects');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const { canDraft } = useAiCapability();

  const { data: allIssues, isLoading: issuesLoading } = useIssues({ projectId });
  const { data: sprints, isLoading: sprintsLoading } = useSprints(projectId);
  const assignToSprint = useAssignIssueToSprint();

  const backlogIssues = allIssues?.filter((issue) => !issue.sprintId) || [];
  const plannedSprints = sprints?.filter((s) => s.status === 'planned') || [];
  const activeSprint = sprints?.find((s) => s.status === 'active');

  const handleAssignToSprint = async (issueId: string, sprintId: string) => {
    try {
      await assignToSprint.mutateAsync({ sprintId, issueId });
    } catch (error) {
      console.error('Failed to assign issue to sprint:', error);
    }
  };

  const handleBulkAssign = async (sprintId: string) => {
    for (const issueId of selectedIssues) {
      await handleAssignToSprint(issueId, sprintId);
    }
    setSelectedIssues([]);
  };

  const toggleIssueSelection = (issueId: string) => {
    setSelectedIssues((prev) =>
      prev.includes(issueId) ? prev.filter((id) => id !== issueId) : [...prev, issueId]
    );
  };

  if (issuesLoading || sprintsLoading) {
    return <BacklogLoadingShell title={t('backlogTitle')} />;
  }

  return (
    <div className="animate-fade-in flex h-full flex-col">
      {/* Header */}
      <div className="command-header shrink-0 border-b px-3 py-2.5 sm:px-5 sm:py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight">{t('backlogTitle')}</h1>
            <span className="text-muted-foreground text-xs">
              {t('issuesCount', { count: backlogIssues.length })}
            </span>
          </div>

          <div className="custom-scrollbar -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0">
            {selectedIssues.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 text-xs sm:h-8"
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {t('moveToSprint', { count: selectedIssues.length })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {activeSprint && (
                    <DropdownMenuItem onClick={() => handleBulkAssign(activeSprint.id)}>
                      {t('sprintActiveLabel', { name: activeSprint.name })}
                    </DropdownMenuItem>
                  )}
                  {plannedSprints.map((sprint) => (
                    <DropdownMenuItem key={sprint.id} onClick={() => handleBulkAssign(sprint.id)}>
                      {sprint.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canDraft && (
              <Button
                size="sm"
                variant="outline"
                className="h-10 shrink-0 gap-1.5 text-xs sm:h-8"
                onClick={() => setAiDraftOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('draftWithAi')}
              </Button>
            )}

            <Button
              size="sm"
              className="h-10 shrink-0 gap-1.5 text-xs sm:h-8"
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('newIssue')}
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="custom-scrollbar flex-1 overflow-auto">
        {backlogIssues.length === 0 ? (
          <div className="animate-fade-up border-border mx-3 mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center sm:mx-auto sm:mt-16 sm:p-8">
            <Inbox className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground text-sm">{t('backlogEmpty')}</p>
            <Button size="sm" variant="outline" onClick={() => setCreateModalOpen(true)}>
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t('createIssue')}
            </Button>
          </div>
        ) : (
          <div role="table" aria-label={t('backlogTitle')} className="min-w-[760px]">
            {/* Table Header */}
            <div
              role="row"
              className="border-border bg-surface text-muted-foreground sticky top-0 z-10 flex min-h-9 items-center gap-3 border-b px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] sm:px-5"
            >
              <div role="columnheader" className="flex w-8 justify-center">
                <Checkbox
                  aria-label={t('allIssues')}
                  checked={
                    selectedIssues.length === backlogIssues.length && backlogIssues.length > 0
                  }
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedIssues(backlogIssues.map((i) => i.id));
                    } else {
                      setSelectedIssues([]);
                    }
                  }}
                />
              </div>
              <div role="columnheader" className="w-20">
                {t('columnKey')}
              </div>
              <div role="columnheader" className="flex-1">
                {t('columnTitle')}
              </div>
              <div role="columnheader" className="w-20 text-center">
                {t('columnType')}
              </div>
              <div role="columnheader" className="w-20 text-center">
                {t('columnPriority')}
              </div>
              <div role="columnheader" className="w-16 text-center">
                {t('columnEstimate')}
              </div>
              <div role="columnheader" className="w-44">
                {t('columnSprint')}
              </div>
            </div>

            {/* Rows */}
            {backlogIssues.map((issue) => {
              const tConfig = typeConfig[issue.type] || {
                icon: FileText,
                color: 'text-muted-foreground',
              };
              const TypeIcon = tConfig.icon;

              return (
                <div
                  key={issue.id}
                  role="row"
                  aria-selected={selectedIssues.includes(issue.id)}
                  className={cn(
                    'border-border/40 hover:bg-accent/40 group flex min-h-11 items-center gap-3 border-b px-4 py-1.5 transition-colors duration-150 sm:px-5',
                    selectedIssues.includes(issue.id) && 'bg-primary/5'
                  )}
                >
                  <div role="cell" className="flex w-8 justify-center">
                    <Checkbox
                      aria-label={`${issue.key} — ${issue.title}`}
                      checked={selectedIssues.includes(issue.id)}
                      onCheckedChange={() => toggleIssueSelection(issue.id)}
                    />
                  </div>

                  <div role="cell" className="w-20">
                    <span className="text-muted-foreground font-mono text-xs">{issue.key}</span>
                  </div>

                  <div role="cell" className="min-w-0 flex-1">
                    <button
                      onClick={() => setSelectedIssueId(issue.id)}
                      className="text-foreground hover:text-primary focus-visible:ring-ring block w-full truncate rounded-sm text-start text-sm font-medium outline-none transition-colors focus-visible:ring-2"
                    >
                      {issue.title}
                    </button>
                  </div>

                  <div role="cell" className="flex w-20 justify-center">
                    <TypeIcon className={cn('h-4 w-4', tConfig.color)} aria-hidden="true" />
                    <span className="sr-only">{issue.type}</span>
                  </div>

                  <div role="cell" className="flex w-20 justify-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        'px-1.5 py-0 text-[10px] font-medium capitalize',
                        issue.priority === 'critical' && 'border-accent-rose/30 text-accent-rose',
                        issue.priority === 'high' && 'border-accent-amber/30 text-accent-amber'
                      )}
                    >
                      {issue.priority}
                    </Badge>
                  </div>

                  <div role="cell" className="w-16 text-center">
                    {issue.estimate ? (
                      <span className="text-muted-foreground text-xs">
                        {t('estimatePoints', { points: issue.estimate })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">-</span>
                    )}
                  </div>

                  <div role="cell" className="w-44">
                    <Select onValueChange={(sprintId) => handleAssignToSprint(issue.id, sprintId)}>
                      <SelectTrigger
                        className="h-8 border-dashed text-xs"
                        aria-label={`${t('columnSprint')}: ${issue.key}`}
                      >
                        <SelectValue placeholder={t('addToSprint')} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSprint && (
                          <SelectItem value={activeSprint.id}>
                            {t('sprintActiveLabel', { name: activeSprint.name })}
                          </SelectItem>
                        )}
                        {plannedSprints.map((sprint) => (
                          <SelectItem key={sprint.id} value={sprint.id}>
                            {sprint.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CreateIssueModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        projectId={projectId}
      />

      <AiDraftIssueDialog open={aiDraftOpen} onOpenChange={setAiDraftOpen} projectId={projectId} />

      {selectedIssueId && (
        <IssueDetailModal
          issueId={selectedIssueId}
          open={!!selectedIssueId}
          onOpenChange={(open) => !open && setSelectedIssueId(null)}
        />
      )}
    </div>
  );
}
