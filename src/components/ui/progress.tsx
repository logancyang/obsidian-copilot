import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "tw-relative tw-h-2 tw-w-full tw-overflow-hidden tw-rounded-full tw-bg-interactive-accent/20 tw-border-interactive-accent/30",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="tw-size-full tw-flex-1 tw-bg-interactive-accent tw-transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
