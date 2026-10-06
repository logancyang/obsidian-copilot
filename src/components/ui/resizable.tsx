import * as React from "react";
import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group className={cn("tw-flex tw-size-full", className)} {...props} />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      "tw-relative tw-flex tw-w-px tw-items-center tw-justify-center tw-bg-[var(--background-modifier-border)] after:tw-absolute after:tw-inset-y-0 after:tw-left-1/2 after:tw-w-1 after:tw--translate-x-1/2 focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring focus-visible:tw-ring-offset-1 aria-[orientation=horizontal]:tw-h-px aria-[orientation=horizontal]:tw-w-full aria-[orientation=horizontal]:after:tw-left-0 aria-[orientation=horizontal]:after:tw-h-1 aria-[orientation=horizontal]:after:tw-w-full aria-[orientation=horizontal]:after:tw--translate-y-1/2 aria-[orientation=horizontal]:after:tw-translate-x-0 [&[aria-orientation=horizontal]>div]:tw-rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="tw-z-sidedock tw-flex tw-h-4 tw-w-3 tw-items-center tw-justify-center tw-rounded-sm tw-border tw-border-solid tw-border-border">
        <GripVertical className="tw-size-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
