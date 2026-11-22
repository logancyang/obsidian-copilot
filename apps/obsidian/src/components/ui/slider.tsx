import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "tw-relative tw-flex tw-w-full tw-touch-none tw-select-none tw-items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="tw-relative tw-h-1.5 tw-w-full tw-grow tw-overflow-hidden tw-rounded-full tw-border tw-border-solid tw-bg-interactive-accent/20 tw-border-interactive-accent/30">
      <SliderPrimitive.Range className="tw-absolute tw-h-full tw-bg-interactive-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="tw-block tw-size-4 tw-rounded-full tw-border tw-bg-toggle-thumb tw-shadow tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-pointer-events-none disabled:tw-opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
