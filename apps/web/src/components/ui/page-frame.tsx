import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageFrameProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PageFrame({ children, className, contentClassName }: PageFrameProps) {
  return (
    <div
      className={cn(
        'bg-workbench-canvas flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div
          className={cn(
            'mx-auto w-full min-w-0 max-w-[1480px] space-y-4 p-3.5 sm:p-4 lg:p-5 xl:px-6 xl:py-5',
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
