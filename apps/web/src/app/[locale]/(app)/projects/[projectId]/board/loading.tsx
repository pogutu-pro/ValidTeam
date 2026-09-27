import { getTranslations } from 'next-intl/server';
import { Skeleton, SkeletonKanbanColumn } from '@/components/ui/skeleton';

export default async function BoardLoading() {
  const [t, tProjects] = await Promise.all([
    getTranslations('userSecurity'),
    getTranslations('pagesProjects'),
  ]);

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{tProjects('tabBoard')}</h1>
      <div className="border-border shrink-0 border-b px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2" aria-busy="true">
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-40 rounded-md sm:h-8" />
            <Skeleton className="h-10 w-10 rounded-md sm:h-8 sm:w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-10 rounded-md sm:h-8 sm:w-24" />
            <Skeleton className="h-10 w-10 rounded-md sm:h-8 sm:w-20" />
          </div>
        </div>
      </div>
      <div className="custom-scrollbar flex-1 overflow-x-auto overflow-y-hidden px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex h-full gap-2.5">
          <SkeletonKanbanColumn title={t('columnBacklog')} cards={3} />
          <SkeletonKanbanColumn title={t('columnToDo')} cards={4} />
          <SkeletonKanbanColumn title={t('columnInProgress')} cards={2} />
          <SkeletonKanbanColumn title={t('columnInReview')} cards={2} />
          <SkeletonKanbanColumn title={t('columnDone')} cards={3} />
        </div>
      </div>
    </div>
  );
}
