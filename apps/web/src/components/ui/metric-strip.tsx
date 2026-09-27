import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MetricStripItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

interface MetricStripProps {
  items: MetricStripItem[];
  className?: string;
}

export function MetricStrip({ items, className }: MetricStripProps) {
  return (
    <dl
      className={cn(
        'metric-strip border-border bg-card/55 grid grid-cols-2 overflow-hidden border-y md:grid-cols-4',
        className
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="metric-strip-item flex min-h-[64px] min-w-0 flex-col justify-center gap-1 px-3 py-2.5 sm:px-4"
        >
          <dt className="text-muted-foreground truncate text-[10px] font-medium uppercase tracking-[0.055em]">
            {item.label}
          </dt>
          <dd className="text-foreground text-[19px] font-semibold tabular-nums leading-none">
            {item.value}
          </dd>
          {item.hint ? (
            <dd className="text-muted-foreground truncate text-[11px]">{item.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
