import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "p-0 border-solid !bg-transparent !shadow transition-colors", // custom styles
      "hover:!bg-interactive-accent hover:!text-on-accent data-[state=checked]:!bg-interactive-accent data-[state=checked]:!text-on-accent", // custom styles
      "peer h-4 w-4 shrink-0 rounded-sm border border-interactive-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-interactive-accent data-[state=checked]:text-on-accent",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("tw-flex tw-items-center tw-justify-center tw-text-current")}
    >
      <Check className="tw-h-4 tw-w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
