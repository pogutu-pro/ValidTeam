import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shimmer bg-muted/40 rounded-md', className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn('h-8 w-8 rounded-full', className)} />;
}

export function SkeletonCard({
  className,
  showAvatar = false,
}: {
  className?: string;
  showAvatar?: boolean;
}) {
  return (
    <div className={cn('border-border bg-card space-y-3 rounded-lg border p-4', className)}>
      {showAvatar && (
        <div className="flex items-center gap-3">
          <SkeletonAvatar />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      )}
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

export function SkeletonRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn('border-border flex items-center gap-4 border-b px-4 py-3', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === 0 ? 'w-1/3' : 'flex-1')} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="border-border bg-card rounded-lg border">
      <div className="border-border bg-muted/20 flex items-center gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 0 ? 'w-1/4' : 'flex-1')} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} columns={columns} />
      ))}
    </div>
  );
}

export function SkeletonList({ items = 5, className }: { items?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="border-border bg-card flex items-center gap-3 rounded-md border px-4 py-3"
        >
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <SkeletonAvatar />
        </div>
      ))}
    </div>
  );
}

export function SkeletonKanbanColumn({ cards = 3, title }: { cards?: number; title?: string }) {
  return (
    <div className="bg-muted/20 flex h-full w-72 shrink-0 flex-col rounded-lg p-3">
      <div className="mb-3 flex items-center justify-between">
        {title ? (
          <span className="text-muted-foreground text-xs font-medium uppercase">{title}</span>
        ) : (
          <Skeleton className="h-3 w-20" />
        )}
        <Skeleton className="h-4 w-6" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="border-border bg-card space-y-2 rounded-md border p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-4 w-12 rounded-full" />
              <SkeletonAvatar className="h-5 w-5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonPageHeader({
  showDescription = true,
  title,
}: {
  showDescription?: boolean;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <h1 className="sr-only">{title}</h1>
      <Skeleton className="h-7 w-56" aria-hidden="true" />
      {showDescription && <Skeleton className="h-4 w-80" />}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-border bg-card space-y-2 rounded-lg border p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}
