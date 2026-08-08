import { cn } from "@/lib/utils";
import { ChevronRight, type LucideIcon } from "lucide-react";
import React, { useId } from "react";

export interface AgentActivityCardProps {
  icon: LucideIcon;
  label: React.ReactNode;
  trailing?: React.ReactNode;
  secondary?: React.ReactNode;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}

/**
 * Provides one visual and interaction contract for reasoning, tools, grouped activity, and delegated work.
 */
export const AgentActivityCard: React.FC<AgentActivityCardProps> = ({
  icon: Icon,
  label,
  trailing,
  secondary,
  expandable = false,
  open = false,
  onToggle,
  children,
}) => {
  const bodyId = useId();
  const canToggle = expandable && onToggle !== undefined;

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col tw-gap-0.5">
      <div
        data-agent-activity-card-header
        className={cn(
          "tw-flex tw-w-full tw-items-center tw-gap-1.5 tw-pl-1 tw-text-left tw-text-sm tw-text-muted",
          canToggle ? "tw-cursor-pointer hover:tw-text-normal" : "tw-cursor-default"
        )}
        role={canToggle ? "button" : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? open : undefined}
        aria-controls={canToggle ? bodyId : undefined}
        onClick={canToggle ? onToggle : undefined}
        onKeyDown={
          canToggle
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onToggle();
              }
            : undefined
        }
      >
        <span className="tw-flex tw-size-3.5 tw-shrink-0 tw-items-center tw-justify-center">
          <Icon className="tw-size-3.5 tw-text-muted" />
        </span>
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1 tw-truncate tw-font-medium">
          {label}
        </div>
        {trailing}
        {canToggle ? (
          <ChevronRight
            className={cn(
              "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
              open && "tw-rotate-90"
            )}
          />
        ) : null}
      </div>
      {secondary ? (
        <div className="tw-truncate tw-pl-6 tw-text-xs tw-text-muted">{secondary}</div>
      ) : null}
      {canToggle && open ? (
        <div
          id={bodyId}
          className="tw-ml-1 tw-mt-1 tw-flex tw-flex-col tw-gap-1 tw-border-l tw-border-border tw-pl-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};
