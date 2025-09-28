import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PillBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function PillBadge({ children, className, ...props }: PillBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "tw-mx-0.5 tw-inline-flex tw-items-center tw-gap-1 tw-border tw-border-solid tw-border-border tw-px-2 tw-py-0 tw-align-middle tw-text-xs",
        className
      )}
      {...props}
    >
      {children}
    </Badge>
  );
}
