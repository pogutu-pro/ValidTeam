import { Skeleton } from '@/components/ui/skeleton';

export function BacklogLoadingShell({ title }: { title: string }) {
  return (
    <div
      className="custom-scrollbar flex h-full flex-col overflow-auto"
      tabIndex={0}
      aria-label={title}
    >
      <h1 className="sr-only">{title}</h1>
      <div className="border-border flex min-h-[3.75rem] shrink-0 items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-md sm:h-8" />
          <Skeleton className="h-10 w-24 rounded-md sm:h-8" />
        </div>
      </div>

      <div className="min-w-[760px]" aria-busy="true">
        <div className="border-border bg-surface flex min-h-9 items-center gap-3 border-b px-4 sm:px-5">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-36" />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="border-border/40 flex min-h-11 items-center gap-3 border-b px-4 sm:px-5"
          >
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-5 w-14 rounded-sm" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-8 w-36 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
