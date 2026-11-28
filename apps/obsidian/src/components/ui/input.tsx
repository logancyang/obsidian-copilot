import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "!tw-h-9 !tw-min-w-[50px] !tw-rounded-md !tw-border tw-border-solid tw-border-border !tw-bg-transparent !tw-px-3 !tw-py-1 !tw-text-sm !tw-transition-colors md:!tw-text-base",
          "focus-visible:!tw-shadow-sm focus-visible:!tw-outline-none focus-visible:!tw-ring-1 focus-visible:!tw-ring-ring",
          "placeholder:tw-text-sm",
          "tw-flex tw-w-full tw-shadow-sm placeholder:tw-text-muted disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
