import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import React, { memo } from "react";

interface AgentHomeTabProps {
  id: string;
  sectionId?: string;
  icon: React.ReactNode;
  title: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  controlsId: string;
  disabled?: boolean;
  disabledTooltip?: string;
}

export const AgentHomeTab = memo(function AgentHomeTab({
  id,
  sectionId,
  icon,
  title,
  count,
  active,
  onClick,
  controlsId,
  disabled = false,
  disabledTooltip,
}: AgentHomeTabProps): React.ReactElement {
  const tab = (
    <Button
      id={id}
      data-section-id={sectionId}
      type="button"
      role="tab"
      variant="ghost2"
      aria-selected={active}
      aria-controls={controlsId}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "tw-h-auto tw-flex-1 tw-gap-2 tw-rounded-md tw-px-3 tw-py-1.5",
        "tw-text-ui-small tw-font-medium tw-duration-200",
        disabled
          ? "tw-cursor-not-allowed tw-bg-transparent tw-text-muted tw-opacity-50"
          : active
            ? "tw-bg-primary tw-text-normal hover:tw-bg-primary"
            : "tw-bg-transparent tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
      )}
    >
      <span className="tw-flex tw-shrink-0 tw-items-center tw-text-muted">{icon}</span>
      <span>{title}</span>
      {!disabled && typeof count === "number" && count > 0 && (
        <span className={cn("tw-text-ui-smaller", active ? "tw-text-muted" : "tw-text-faint")}>
          {count}
        </span>
      )}
    </Button>
  );

  if (disabled && disabledTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{tab}</TooltipTrigger>
        <TooltipContent side="top">{disabledTooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return tab;
});
