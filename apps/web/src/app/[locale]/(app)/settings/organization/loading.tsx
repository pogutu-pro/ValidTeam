import { Skeleton } from '@/components/ui/skeleton';
import { PageFrame } from '@/components/ui/page-frame';

export default function OrganizationSettingsLoading() {
  return (
    <PageFrame contentClassName="max-w-5xl animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="border-border bg-card space-y-5 rounded-lg border p-4 sm:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full max-w-md rounded-md" />
          </div>
        ))}
        <div className="pt-2">
          <Skeleton className="h-9 w-full rounded-md sm:w-32" />
        </div>
      </div>
    </PageFrame>
  );
}
