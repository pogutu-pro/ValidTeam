import { Skeleton } from '@/components/ui/skeleton';
import { PageFrame } from '@/components/ui/page-frame';

export default function SettingsLoading() {
  return (
    <PageFrame contentClassName="max-w-5xl animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full max-w-md rounded-md" />
        </div>
      ))}
    </PageFrame>
  );
}
