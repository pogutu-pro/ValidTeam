import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  headingLevel?: 1 | 2;
  description?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  headingLevel = 1,
  description,
  kicker,
  actions,
  className,
}: PageHeaderProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  return (
    <header
      className={cn(
        'border-border/70 flex min-w-0 flex-col gap-3 border-b pb-3.5 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        {kicker ? <div className="kicker">{kicker}</div> : null}
        <Heading className="text-foreground text-balance text-[21px] font-semibold leading-tight tracking-[-0.012em] sm:text-[23px]">
          {title}
        </Heading>
        {description ? (
          <p className="text-muted-foreground max-w-3xl text-[13px] leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
