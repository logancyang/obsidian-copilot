import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";
import React from "react";

export interface ScrollToBottomButtonProps {
  /** Invoked when the user asks to jump back to the newest message. */
  onClick: () => void;
}

/**
 * Floating circular affordance that overlays the chat message list when the
 * user has scrolled away from the newest message. Purely presentational: the
 * owning list decides visibility and supplies the scroll action.
 */
export function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="Scroll to latest message"
      title="Scroll to latest message"
      onClick={() => onClick()}
      className={cn(
        "tw-absolute tw-bottom-2 tw-left-1/2 tw-z-cover -tw-translate-x-1/2 tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-md hover:tw-bg-interactive-hover"
      )}
    >
      <ArrowDown className="tw-size-4" />
    </Button>
  );
}
