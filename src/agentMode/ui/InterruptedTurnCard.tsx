import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PauseCircle } from "lucide-react";
import React from "react";

interface InterruptedTurnCardProps {
  onResume: () => void;
  onRetry: () => void;
}

export const InterruptedTurnCard: React.FC<InterruptedTurnCardProps> = ({ onResume, onRetry }) => (
  <div className="tw-px-3 tw-pt-2">
    <Card
      role="status"
      className="tw-flex tw-w-full tw-flex-col tw-items-start tw-gap-2 tw-rounded-md tw-border-solid tw-bg-callout-warning/20 tw-px-3 tw-py-2 tw-text-xs tw-shadow-none tw-border-warning/40"
    >
      <span className="tw-flex tw-items-center tw-gap-2 tw-font-medium tw-text-normal">
        <PauseCircle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-warning" />
        Interrupted
      </span>
      <p className="tw-m-0 tw-text-muted">
        This turn was cut off when Obsidian closed. Nothing has been sent again.
      </p>
      <div className="tw-flex tw-gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="tw-border tw-border-solid tw-border-border"
          title="Ask the agent to continue from where it left off"
          onClick={onResume}
        >
          Resume
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="tw-border tw-border-solid tw-border-border"
          title="Send the same prompt and context again"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </Card>
  </div>
);
