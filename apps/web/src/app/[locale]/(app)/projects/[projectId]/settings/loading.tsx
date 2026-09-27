import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';

export default async function ProjectSettingsLoading() {
  const t = await getTranslations('pagesProjects');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <h1 className="sr-only">{t('projectSettings')}</h1>
      <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full max-w-md rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
