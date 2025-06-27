import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("tw-relative tw-overflow-hidden", className)}
    {...props}
  >
    {/*[&>div:first-child]:!tw-block：for override the first child div style's (display: table)*/}
    <ScrollAreaPrimitive.Viewport className="tw-size-full tw-rounded-[inherit] [&>div:first-child]:!tw-block">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "tw-flex tw-touch-none tw-select-none tw-transition-colors",
      orientation === "vertical" &&
        "tw-h-full tw-w-2.5 tw-border-l tw-border-l-transparent tw-p-px",
      orientation === "horizontal" &&
        "tw-h-2.5 tw-flex-col tw-border-t tw-border-t-transparent tw-p-px",
      className
    )}
    {...props}
  >
    {/* tw-bg-border -> --divider-color: var(--background-modifier-border); */}
    <ScrollAreaPrimitive.ScrollAreaThumb className="tw-relative tw-flex-1 tw-rounded-full tw-bg-[var(--background-modifier-border)]" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
