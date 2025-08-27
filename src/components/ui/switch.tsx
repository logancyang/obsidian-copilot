import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "tw-peer tw-inline-flex tw-h-5 tw-w-9 tw-shrink-0 tw-cursor-pointer",
      "tw-border-2 tw-items-center tw-rounded-full tw-border-transparent",
      "tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-2",
      "focus-visible:tw-ring-ring focus-visible:tw-ring-offset-2",
      "focus-visible:tw-ring-offset-background",
      "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
      "data-[state=unchecked]:tw-bg-input data-[state=checked]:tw-bg-primary",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "tw-pointer-events-none tw-block tw-size-4 tw-rounded-full",
        "tw-bg-background tw-shadow-lg tw-ring-0",
        "tw-transition-transform",
        "data-[state=checked]:tw-translate-x-4 data-[state=unchecked]:tw-translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
