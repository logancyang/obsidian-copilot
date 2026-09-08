import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import React from "react";

export interface RelevantNotesShelfPanelProps {
  /** Open the dedicated Relevant Notes pane (the shelf is transient). */
  onPopOut: () => void;
  children: React.ReactNode;
}

/** Keep the dedicated-pane action available below the transient shelf's results. */
export function RelevantNotesShelfPanel({ onPopOut, children }: RelevantNotesShelfPanelProps) {
  return (
    <div className="tw-flex tw-min-h-0 tw-w-full tw-flex-1 tw-flex-col tw-overflow-hidden">
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden">{children}</div>
      <Button
        type="button"
        variant="ghost2"
        size="sm"
        className="tw-mt-1 tw-w-full tw-shrink-0 tw-text-muted focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
        onClick={onPopOut}
      >
        <ExternalLink className="tw-size-3" aria-hidden="true" />
        Open in separate pane
      </Button>
    </div>
  );
}
