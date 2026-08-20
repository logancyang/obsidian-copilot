import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";
import React from "react";

export interface ScrollToBottomButtonProps {
  /** Invoked when the user asks to jump back to the newest message. */
  onClick: () => void;
  /**
   * Forwards wheel deltas to the message list, so hovering the button never
   * traps the user's scrolling.
   */
  onScrollWheel: (deltaY: number) => void;
  /**
   * While a response is streaming, the arrow becomes a typing indicator so
   * the button doubles as a "content is still arriving below" signal.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/329
   */
  isStreaming?: boolean;
}

/**
 * Floating circular affordance that overlays the chat message list when the
 * user has scrolled away from the newest message. Purely presentational: the
 * owning list decides visibility and supplies the scroll actions.
 */
export function ScrollToBottomButton({
  onClick,
  onScrollWheel,
  isStreaming = false,
}: ScrollToBottomButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="Scroll to latest message"
      title="Scroll to latest message"
      onClick={() => onClick()}
      onWheel={(event) => onScrollWheel(event.deltaY)}
      className={cn(
        // copilot-scroll-to-bottom-button (tailwind.css) re-points the
        // interactive background variables at the page background, since
        // Obsidian's core `button` rule outranks single-class bg utilities.
        "copilot-scroll-to-bottom-button",
        "tw-absolute tw-bottom-2 tw-left-1/2 tw-z-cover -tw-translate-x-1/2 tw-rounded-full tw-border tw-border-solid tw-border-border-hover tw-shadow-md"
      )}
    >
      {isStreaming ? (
        <span className="tw-flex tw-items-center tw-gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((dotIndex) => (
            <span
              key={dotIndex}
              // eslint-disable-next-line tailwindcss/no-custom-classname -- typing-dot is a component animation class defined in source CSS
              className={cn(
                "tw-size-1 tw-rounded-full tw-bg-current",
                "copilot-typing-dot",
                dotIndex > 0 && `copilot-typing-dot-${dotIndex}`
              )}
            />
          ))}
        </span>
      ) : (
        <ArrowDown className="tw-size-4" />
      )}
    </Button>
  );
}
