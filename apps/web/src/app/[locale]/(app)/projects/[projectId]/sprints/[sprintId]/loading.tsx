import { getTranslations } from 'next-intl/server';
import { Skeleton, SkeletonKanbanColumn } from '@/components/ui/skeleton';

export default async function SprintDetailLoading() {
  const t = await getTranslations('pagesProjects');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{t('loadingSprint')}</h1>
      <div className="border-border shrink-0 space-y-2.5 border-b px-3 py-2.5 sm:px-5 sm:py-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="border-border bg-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="bg-card space-y-2 p-3 sm:p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-1 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex h-full gap-2.5">
          <SkeletonKanbanColumn cards={3} />
          <SkeletonKanbanColumn cards={2} />
          <SkeletonKanbanColumn cards={4} />
          <SkeletonKanbanColumn cards={2} />
        </div>
      </div>
    </div>
  );
}
