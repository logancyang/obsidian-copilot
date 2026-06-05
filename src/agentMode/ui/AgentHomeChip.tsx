import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import React, { memo } from "react";

interface AgentHomeChipProps {
  /** Leading type icon (sized by the caller, typically `tw-size-4`). */
  icon: React.ReactNode;
  title: string;
  count: number;
  onClick: () => void;
}

/**
 * Pill button in the collapsed Agent Home shelf — one per section. Activating it
 * opens that section's panel, which replaces the whole chip row (see
 * {@link AgentHomeShelf}), so the chip has no persistent "open" state of its own.
 * Built on the shared {@link Button} (secondary variant) for a neutral bordered
 * pill.
 */
export const AgentHomeChip = memo(function AgentHomeChip({
  icon,
  title,
  count,
  onClick,
}: AgentHomeChipProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      className={cn(
        "tw-h-auto tw-gap-2 tw-rounded-md  tw-bg-primary tw-px-3 tw-py-2",
        "tw-text-normal tw-shadow-none tw-duration-200 hover:tw-bg-modifier-hover"
      )}
    >
      <span className="tw-flex tw-shrink-0 tw-items-center tw-text-muted">{icon}</span>
      <span className="tw-text-ui-small tw-font-medium">{title}</span>
      <span className="tw-text-ui-smaller tw-text-muted">{count}</span>
    </Button>
  );
});
