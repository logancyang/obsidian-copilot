import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "!h-9 !min-w-[50px] !border border-border border-solid !rounded-md !bg-transparent !px-3 !py-1 md:!text-base !text-sm !transition-colors",
          "focus-visible:!shadow-sm focus-visible:!outline-none focus-visible:!ring-1 focus-visible:!ring-ring",
          "placeholder:text-xs", // custom styles
          "flex w-full shadow-sm placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
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
