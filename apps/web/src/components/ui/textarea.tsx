import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'border-border bg-card ease-snap placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:border-ring aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
