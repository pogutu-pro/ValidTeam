import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { PageFrame } from '@/components/ui/page-frame';

export default function MembersLoading() {
  return (
    <PageFrame contentClassName="max-w-5xl animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full rounded-md sm:w-32" />
      </div>
      <SkeletonTable rows={8} columns={5} />
    </PageFrame>
  );
}
