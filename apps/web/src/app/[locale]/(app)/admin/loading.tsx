import { getTranslations } from 'next-intl/server';
import { Skeleton, SkeletonPageHeader, SkeletonTable } from '@/components/ui/skeleton';
import { MetricStrip, type MetricStripItem } from '@/components/ui/metric-strip';
import { PageFrame } from '@/components/ui/page-frame';

export default async function AdminLoading() {
  const t = await getTranslations('pagesAdmin');
  const metrics: MetricStripItem[] = Array.from({ length: 4 }, (_, index) => ({
    id: `admin-metric-${index}`,
    label: <Skeleton className="h-3 w-16" />,
    value: <Skeleton className="h-7 w-10" />,
  }));

  return (
    <PageFrame contentClassName="max-w-none animate-pulse">
      <SkeletonPageHeader title={t('nav.overview')} />
      <MetricStrip items={metrics} />
      <div className="flex items-center gap-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-md" />
        ))}
      </div>
      <SkeletonTable rows={8} columns={5} />
    </PageFrame>
  );
}
