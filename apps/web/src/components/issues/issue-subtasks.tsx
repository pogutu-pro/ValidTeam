'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, CheckCircle2, Circle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateIssue } from '@/lib/hooks/use-issues';
import { useCreateSubIssue, useSubIssueParentContext } from '@/lib/hooks/use-subtask-create';
import Link from 'next/link';

interface IssueSubtasksProps {
  issueId: string;
  projectId: string;
}

interface Subtask {
  id: string;
  key: string;
  title: string;
  statusId: string;
  statusName: string;
  /** GET /api/issues exposes the workflow category as `status`. */
  status: string;
  priority: string;
}

interface WorkflowStatusSummary {
  id: string;
  category: string;
  position: number;
}

interface WorkflowTransitionSummary {
  id: string;
  name: string;
  fromStatusId: string;
  toStatusId: string;
}

interface WorkflowGraph {
  statuses: WorkflowStatusSummary[];
  transitions: WorkflowTransitionSummary[];
}

/**
 * Pick the most useful legal next step for the compact status control.
 *
 * A sub-issue checkbox must respect the configured workflow graph: a Backlog
 * item cannot jump straight to Done when the project requires Backlog → In
 * Progress → Done. Prefer a direct completion/reopen edge when one exists;
 * otherwise advance to the nearest forward state.
 */
function selectPrimaryTransition(
  subtask: Subtask,
  graph: WorkflowGraph | undefined
): WorkflowTransitionSummary | null {
  if (!graph) return null;

  const statusById = new Map(graph.statuses.map((status) => [status.id, status]));
  const current = statusById.get(subtask.statusId);
  const currentCategory = current?.category ?? subtask.status;
  const outgoing = graph.transitions.filter(
    (transition) => transition.fromStatusId === subtask.statusId
  );
  if (outgoing.length === 0) return null;

  return [...outgoing].sort((left, right) => {
    const leftTarget = statusById.get(left.toStatusId);
    const rightTarget = statusById.get(right.toStatusId);

    const score = (target: WorkflowStatusSummary | undefined) => {
      if (!target) return 10_000;
      if (currentCategory === 'done') {
        if (target.category === 'backlog') return 0;
        if (target.category !== 'done') return 100 + target.position;
        return 1_000 + target.position;
      }
      if (target.category === 'done') return 0;
      if (current && target.position > current.position) {
        return 100 + (target.position - current.position);
      }
      return 1_000 + target.position;
    };

    return score(leftTarget) - score(rightTarget) || left.id.localeCompare(right.id);
  })[0]!;
}

export function IssueSubtasks({ issueId, projectId }: IssueSubtasksProps) {
  const t = useTranslations('subtaskCreate');
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const createSubIssue = useCreateSubIssue();
  const updateIssue = useUpdateIssue();
  const { data: parentContext } = useSubIssueParentContext(issueId, projectId);

  // Fetch subtasks
  const {
    data: subtasks,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['subtasks', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/issues?parentId=${issueId}`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.issues || []) as Subtask[];
    },
  });

  const { data: workflowGraph, isLoading: isWorkflowGraphLoading } = useQuery<WorkflowGraph>({
    queryKey: ['workflow-transitions', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/workflow-transitions`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<WorkflowGraph>;
    },
  });

  const transitionBySubtaskId = useMemo(
    () =>
      new Map(
        (subtasks ?? []).map((subtask) => [
          subtask.id,
          selectPrimaryTransition(subtask, workflowGraph),
        ])
      ),
    [subtasks, workflowGraph]
  );

  const handleCreateSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setCreateError(null);
    try {
      await createSubIssue.mutateAsync({
        parentId: issueId,
        title: newTitle.trim(),
        // Inherit the parent's project + sprint/epic when present, falling
        // back to the project id we already hold while the parent loads.
        context: parentContext ?? { projectId },
      });
      setNewTitle('');
      setIsAdding(false);
      refetch();
    } catch (error) {
      console.error('Error creating subtask:', error);
      setCreateError(t('createFailed'));
    }
  };

  const handleToggleComplete = async (subtask: Subtask) => {
    const transition = transitionBySubtaskId.get(subtask.id);
    if (!transition) return;
    setTransitionError(null);
    try {
      await updateIssue.mutateAsync({
        issueId: subtask.id,
        data: { statusId: transition.toStatusId },
      });
      await refetch();
    } catch (error) {
      console.error('Error updating subtask:', error);
      setTransitionError(t('transitionFailed'));
    }
  };

  const completedCount = subtasks?.filter((s) => s.status === 'done').length || 0;
  const totalCount = subtasks?.length || 0;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2">
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary ease-smooth h-full transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-muted-foreground text-xs">
            {completedCount}
            {'/'}
            {totalCount}
          </span>
        </div>
      )}

      {/* Subtasks list */}
      {subtasks && subtasks.length > 0 ? (
        <ul className="stagger space-y-0.5">
          {subtasks.map((subtask) => {
            const transition = transitionBySubtaskId.get(subtask.id);
            const fallbackLabel =
              subtask.status === 'done' ? t('markIncomplete') : t('markComplete');

            return (
              <li
                key={subtask.id}
                className="row-interactive group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
              >
                <button
                  onClick={() => handleToggleComplete(subtask)}
                  className="shrink-0"
                  disabled={updateIssue.isPending || isWorkflowGraphLoading || transition == null}
                  aria-label={transition?.name || fallbackLabel}
                  title={transition?.name || undefined}
                >
                  {subtask.status === 'done' ? (
                    <CheckCircle2 className="text-accent-emerald h-4 w-4" />
                  ) : (
                    <Circle className="text-muted-foreground hover:text-primary h-4 w-4 transition-colors duration-150" />
                  )}
                </button>
                <Link
                  href={`/issues/${subtask.id}`}
                  className={`hover:text-primary ease-snap flex min-w-0 flex-1 items-center gap-1.5 text-sm transition-colors duration-150 ${
                    subtask.status === 'done' ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  <span className="chip shrink-0 rounded-sm font-mono text-[11px]">
                    {subtask.key}
                  </span>
                  <span className="truncate">{subtask.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : !isAdding ? (
        <p className="text-muted-foreground py-2 text-center text-sm">{t('noSubtasks')}</p>
      ) : null}

      {transitionError ? (
        <p className="text-destructive px-1 text-xs" role="alert">
          {transitionError}
        </p>
      ) : null}

      {/* Add subtask form */}
      {isAdding ? (
        <form onSubmit={handleCreateSubtask} className="space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value);
                if (createError) setCreateError(null);
              }}
              placeholder={t('placeholder')}
              autoFocus
              className="min-w-0 flex-1"
              aria-invalid={!!createError}
            />
            <Button type="submit" size="sm" disabled={createSubIssue.isPending || !newTitle.trim()}>
              {createSubIssue.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('addSubIssue')
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setCreateError(null);
              }}
              aria-label={t('addSubIssue')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {createSubIssue.isPending ? (
            <p className="text-muted-foreground px-1 text-xs">{t('creating')}</p>
          ) : null}
          {createError ? (
            <p className="text-destructive px-1 text-xs" role="alert">
              {createError}
            </p>
          ) : null}
        </form>
      ) : (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('addSubIssue')}
        </Button>
      )}
    </div>
  );
}
