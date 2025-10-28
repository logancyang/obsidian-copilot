import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ContextBadgeWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  hasRemoveButton?: boolean;
  isClickable?: boolean;
}

export function ContextBadgeWrapper({
  children,
  className,
  hasRemoveButton = false,
  isClickable = false,
  ...props
}: ContextBadgeWrapperProps) {
  return (
    <Badge
      variant="default"
      className={cn(
        "tw-items-center tw-border tw-border-solid tw-border-border tw-py-0 tw-pl-2 tw-text-xs",
        hasRemoveButton ? "tw-pr-0.5" : "tw-pr-2",
        isClickable && "tw-cursor-pointer hover:tw-bg-interactive-hover",
        className
      )}
      {...props}
    >
      {children}
    </Badge>
  );
}
