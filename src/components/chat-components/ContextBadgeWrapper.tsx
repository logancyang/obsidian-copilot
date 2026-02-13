import React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ContextBadgeWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  icon: React.ReactNode;
  onRemove?: () => void;
  className?: string;
  isClickable?: boolean;
}

export function ContextBadgeWrapper({
  children,
  icon,
  onRemove,
  className,
  isClickable = false,
  ...props
}: ContextBadgeWrapperProps) {
  return (
    <Badge
      variant="default"
      className={cn(
        "tw-group/badge tw-items-center tw-gap-1 tw-border tw-border-solid tw-border-border tw-py-1 tw-pl-1.5 tw-pr-2 tw-text-xs",
        isClickable && "tw-cursor-pointer hover:tw-bg-interactive-hover",
        className
      )}
      {...props}
    >
      <span className="tw-relative tw-size-4 tw-shrink-0">
        <span
          className={cn(
            "tw-flex tw-size-full tw-items-center tw-justify-center",
            onRemove &&
              "context-badge-icon-removable group-focus-within/badge:tw-invisible group-hover/badge:tw-invisible"
          )}
        >
          {icon}
        </span>
        {onRemove && (
          <div
            role="button"
            tabIndex={0}
            className="context-badge-close tw-invisible tw-absolute tw-inset-0 tw-flex tw-cursor-pointer tw-items-center tw-justify-center tw-text-muted group-focus-within/badge:tw-visible group-hover/badge:tw-visible"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            aria-label="Remove from context"
          >
            <X className="tw-size-3" />
          </div>
        )}
      </span>
      {children}
    </Badge>
  );
}
