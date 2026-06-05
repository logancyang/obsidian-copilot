import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import React, { memo } from "react";

interface AgentHomeTabProps {
  /** Stable id for this tab, so the panel can reference it via aria-labelledby. */
  id: string;
  /** Leading type icon (sized by the caller, typically `tw-size-4`). */
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Whether this tab is the selected one. */
  active: boolean;
  onClick: () => void;
  /** id of the panel this tab controls, for `aria-controls`. */
  controlsId: string;
}

/**
 * One segment of the Agent Home shelf's tab bar. Selection is shown purely by
 * background: the selected tab fills white (bg-primary) while the others stay
 * transparent and muted, showing the secondary track behind them — no borders,
 * no shadow. Built on the shared {@link Button} with the `ghost2` variant (which
 * carries `clickable-icon`, resetting Obsidian's native button chrome so a tab
 * doesn't render as a raised default button) and `role="tab"` for the tablist.
 */
export const AgentHomeTab = memo(function AgentHomeTab({
  id,
  icon,
  title,
  count,
  active,
  onClick,
  controlsId,
}: AgentHomeTabProps): React.ReactElement {
  return (
    <Button
      id={id}
      type="button"
      role="tab"
      variant="ghost2"
      aria-selected={active}
      aria-controls={controlsId}
      onClick={onClick}
      className={cn(
        "tw-h-auto tw-flex-1 tw-gap-2 tw-rounded-md tw-px-3 tw-py-1.5",
        "tw-text-ui-small tw-font-medium tw-duration-200",
        active
          ? "tw-bg-primary tw-text-normal hover:tw-bg-primary"
          : "tw-bg-transparent tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
      )}
    >
      <span className="tw-flex tw-shrink-0 tw-items-center tw-text-muted">{icon}</span>
      <span>{title}</span>
      <span className={cn("tw-text-ui-smaller", active ? "tw-text-muted" : "tw-text-faint")}>
        {count}
      </span>
    </Button>
  );
});
