'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowUpRight, Flag, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Goals roll-up — the leadership-facing half of the dashboard.
 *
 * The rest of the dashboard answers "what do I do next"; this answers "are the
 * goals we committed to actually moving". Progress is rolled up by the server
 * (`/api/initiatives/[id]/roll-up`) across every linked project, so this widget
 * never recomputes its own numbers.
 */

interface InitiativeNode {
  id: string;
  name: string;
  slug: string;
  status: string;
  targetDate: string | null;
  color: string | null;
  parentInitiativeId: string | null;
  children: InitiativeNode[];
}

interface RollUp {
  done: number;
  total: number;
  percent: number;
  projectCount: number;
}

const MAX_ROWS = 5;

function progressTone(percent: number): string {
  if (percent >= 80) return 'bg-emerald-500';
  if (percent >= 40) return 'bg-primary';
  if (percent > 0) return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

function atRiskTone(targetDate: string | null, percent: number, now: number): boolean {
  if (!targetDate) return false;
  const target = new Date(targetDate).getTime();
  if (Number.isNaN(target)) return false;
  return target <= now && percent < 100;
}

export function GoalsRollupWidget() {
  const t = useTranslations('dashboardExtra');
  const tCommon = useTranslations('common');
  const tActions = useTranslations('actions');
  const formatter = useFormatter();

  const [initiatives, setInitiatives] = useState<InitiativeNode[] | null>(null);
  const [rollups, setRollups] = useState<Record<string, RollUp>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const listResponse = await fetch('/api/initiatives');
        if (!listResponse.ok) throw new Error(`initiatives ${listResponse.status}`);
        const payload = (await listResponse.json()) as { initiatives?: InitiativeNode[] };
        if (cancelled) return;

        const roots = payload.initiatives ?? [];
        setInitiatives(roots);
        setIsLoading(false);
        if (roots.length === 0) return;

        // Only the visible rows need progress, so cap the fan-out and let the
        // browser share connections rather than firing one request per goal.
        const targets = roots.slice(0, MAX_ROWS);
        const results = await Promise.all(
          targets.map(async (initiative) => {
            try {
              const rollupResponse = await fetch(`/api/initiatives/${initiative.id}/roll-up`);
              if (!rollupResponse.ok) return null;
              return (await rollupResponse.json()) as RollUp;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;

        setRollups(
          Object.fromEntries(
            targets
              .map((initiative, index) => [initiative.id, results[index]] as const)
              .filter((pair): pair is readonly [string, RollUp] => pair[1] !== null)
          )
        );
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const rows = useMemo(
    () =>
      (initiatives ?? []).slice(0, MAX_ROWS).map((initiative) => ({
        initiative,
        rollup: rollups[initiative.id],
      })),
    [initiatives, rollups]
  );

  const anyAtRisk = useMemo(
    () =>
      rows.some(({ initiative, rollup }) =>
        atRiskTone(initiative.targetDate, rollup?.percent ?? 0, now)
      ),
    [rows, now]
  );

  return (
    <div className="surface-card min-w-0 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm font-semibold tracking-tight">
            {t('goals.heading')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('goals.subheading')}</p>
        </div>
        <Link
          href="/initiatives"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {tActions('view_all')}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-8"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">{tCommon('loading')}</span>
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <p className="text-muted-foreground text-sm">{t('goals.unavailable')}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Flag className="text-muted-foreground mb-2 h-7 w-7" />
          <p className="text-muted-foreground text-sm">{t('goals.empty')}</p>
          <p className="text-muted-foreground mt-1 max-w-[26ch] text-xs">{t('goals.empty_hint')}</p>
        </div>
      ) : (
        <>
          <ul className="space-y-0.5">
            {rows.map(({ initiative, rollup }) => {
              const percent = rollup?.percent ?? 0;
              const atRisk = atRiskTone(initiative.targetDate, percent, now);
              return (
                <li key={initiative.id}>
                  <Link
                    href={`/initiatives/${initiative.id}`}
                    className="row-interactive focus-visible:ring-ring flex min-h-11 min-w-0 flex-col gap-1.5 rounded-md px-2 py-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-sm"
                        style={{
                          backgroundColor: initiative.color || 'var(--primary)',
                        }}
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {initiative.name}
                      </span>
                      {atRisk ? (
                        <span className="shrink-0 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          {t('goals.at_risk')}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground w-9 shrink-0 text-end font-mono text-xs tabular-nums">
                        {percent}%
                      </span>
                    </span>

                    <span
                      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={initiative.name}
                    >
                      <span
                        className={cn('block h-full rounded-full', progressTone(percent))}
                        style={{ width: `${Math.max(percent, 2)}%` }}
                      />
                    </span>

                    <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      {rollup ? (
                        <span className="tabular-nums">
                          {t('goals.progress', { done: rollup.done, total: rollup.total })}
                        </span>
                      ) : (
                        <span className="italic">{t('goals.progress_pending')}</span>
                      )}
                      {initiative.targetDate ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {t('goals.target', {
                              date: formatter.dateTime(new Date(initiative.targetDate), {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              }),
                            })}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {anyAtRisk ? (
            <p className="text-muted-foreground mt-3 border-t pt-3 text-[11px] leading-5">
              {t('goals.at_risk_hint')}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
