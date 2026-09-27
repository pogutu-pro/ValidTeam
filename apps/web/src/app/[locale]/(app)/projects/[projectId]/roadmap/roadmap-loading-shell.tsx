import { Skeleton } from '@/components/ui/skeleton';

export function RoadmapLoadingShell({ title }: { title: string }) {
  return (
    <div className="custom-scrollbar flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{title}</h1>
      <div className="border-border flex shrink-0 flex-col gap-3 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-72 max-w-full rounded-md sm:h-8" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row" aria-busy="true">
        <div className="border-border max-h-60 w-full shrink-0 border-b sm:max-h-none sm:w-[280px] sm:border-b-0 sm:border-e lg:w-[320px]">
          <div className="border-border flex min-h-11 items-center border-b px-4">
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex min-h-11 items-center gap-2 px-4">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>

        <div className="custom-scrollbar min-h-[20rem] flex-1 overflow-x-auto sm:min-h-0">
          <div className="min-w-[640px]">
            <div className="border-border grid grid-cols-3 border-b">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="border-border border-e px-3 py-3 last:border-e-0">
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="border-border/40 relative h-11 border-b">
                <Skeleton
                  className="absolute inset-y-1 h-9 rounded-sm"
                  style={{ insetInlineStart: `${8 + index * 4}%`, width: `${24 + index * 6}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
