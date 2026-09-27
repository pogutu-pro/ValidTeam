'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

interface ProgressExtraProps {
  indeterminate?: boolean;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & ProgressExtraProps
>(({ className, value, indeterminate, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      'bg-muted relative h-2 w-full overflow-hidden rounded-full',
      indeterminate && 'progress-bar-indeterminate',
      className
    )}
    {...props}
  >
    {!indeterminate && (
      <ProgressPrimitive.Indicator
        className="bg-primary ease-smooth h-full w-full flex-1 transition-transform duration-300"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    )}
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
