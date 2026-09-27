'use client';

import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { Sprint, SprintIssue } from '@/lib/hooks/use-sprints';
import { differenceInDays } from 'date-fns';

interface SprintStatsProps {
  sprint: Sprint;
  issues: SprintIssue[];
}

export function SprintStats({ sprint, issues }: SprintStatsProps) {
  const t = useTranslations('sprints');
  // Calculate stats
  const totalIssues = issues.length;
  const completedIssues = issues.filter(
    (issue) => issue.status === 'done' || issue.statusName === 'Done'
  ).length;
  const inProgressIssues = issues.filter(
    (issue) => issue.status === 'in_progress' || issue.statusName === 'In Progress'
  ).length;
  const todoIssues = totalIssues - completedIssues - inProgressIssues;

  const completionPercentage = totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

  // Calculate time stats
  const totalDays = differenceInDays(new Date(sprint.endDate), new Date(sprint.startDate));
  const daysElapsed = Math.max(
    0,
    Math.min(totalDays, differenceInDays(new Date(), new Date(sprint.startDate)))
  );
  const daysRemaining = Math.max(0, differenceInDays(new Date(sprint.endDate), new Date()));
  const timePercentage = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;

  // Calculate story points (if available)
  const totalPoints = issues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  const completedPoints = issues
    .filter((issue) => issue.status === 'done' || issue.statusName === 'Done')
    .reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  const pointsPercentage = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;

  const statusChipClass =
    sprint.status === 'active'
      ? 'chip-blue'
      : sprint.status === 'completed'
        ? 'chip-emerald'
        : 'chip-amber';
  const statusLabel =
    sprint.status === 'active'
      ? t('status.active')
      : sprint.status === 'completed'
        ? t('status.completed')
        : t('status.planned');

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 space-y-0.5">
          <span className="kicker">{t('kicker')}</span>
          <h3 className="truncate text-sm font-semibold tracking-tight">{sprint.name}</h3>
        </div>
        <span className={statusChipClass}>{statusLabel}</span>
      </div>
      <div className="bg-border grid gap-px sm:grid-cols-2 xl:grid-cols-4">
        {/* Completion */}
        <div className="bg-card space-y-2 p-3 sm:p-4">
          <span className="kicker">{t('completion')}</span>
          <div className="text-foreground text-xl font-semibold tabular-nums">
            {Math.round(completionPercentage)}%
          </div>
          <Progress value={completionPercentage} className="h-1" />
          <p className="text-muted-foreground text-xs">
            {t('completedOfTotal', { completed: completedIssues, total: totalIssues })}
          </p>
        </div>

        {/* Time Progress */}
        <div className="bg-card space-y-2 p-3 sm:p-4">
          <span className="kicker">{t('time')}</span>
          <div className="text-foreground text-xl font-semibold tabular-nums">
            {Math.round(timePercentage)}%
          </div>
          <Progress value={timePercentage} className="h-1" />
          <p className="text-muted-foreground text-xs">
            {t('daysRemaining', { count: daysRemaining })}
          </p>
        </div>

        {/* Story Points */}
        <div className="bg-card space-y-2 p-3 sm:p-4">
          <span className="kicker">{t('storyPoints')}</span>
          <div className="text-foreground text-xl font-semibold tabular-nums">
            {completedPoints}
            <span className="text-muted-foreground text-base font-normal"> / {totalPoints}</span>
          </div>
          <Progress value={pointsPercentage} className="h-1" />
          <p className="text-muted-foreground text-xs">
            {t('percentCompleted', { percent: Math.round(pointsPercentage) })}
          </p>
        </div>

        {/* Issue Breakdown */}
        <div className="bg-card space-y-2 p-3 sm:p-4">
          <span className="kicker">{t('issues')}</span>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span className="bg-accent-emerald inline-block h-1.5 w-1.5 rounded-full" />
                {t('done')}
              </span>
              <span className="font-semibold tabular-nums">{completedIssues}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span className="bg-primary inline-block h-1.5 w-1.5 rounded-full" />
                {t('inProgress')}
              </span>
              <span className="font-semibold tabular-nums">{inProgressIssues}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span className="bg-muted-foreground/40 inline-block h-1.5 w-1.5 rounded-full" />
                {t('todo')}
              </span>
              <span className="font-semibold tabular-nums">{todoIssues}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
