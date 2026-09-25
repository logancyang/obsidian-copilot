import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import React from "react";

export interface ChatTranscriptViewportProps {
  children: React.ReactNode;
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  contentRef: (node: HTMLDivElement | null) => void;
  onScroll: () => void;
  isScrollPaused: boolean;
  scrollToEnd: () => void;
}

/** Keeps the transcript and its return control together, clear of other chat rails. */
export function ChatTranscriptViewport({
  children,
  scrollContainerRef,
  contentRef,
  onScroll,
  isScrollPaused,
  scrollToEnd,
}: ChatTranscriptViewportProps) {
  return (
    <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        data-testid="chat-messages"
        className="tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
      >
        <div ref={contentRef} className="tw-w-full">
          {children}
        </div>
      </div>
      {/* Readers need a way back after pausing on an earlier turn.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/277 */}
      {isScrollPaused && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Scroll to end"
          title="Scroll to end"
          onClick={scrollToEnd}
          className="tw-absolute tw-inset-x-0 tw-bottom-3 tw-z-[1] tw-mx-auto tw-size-8 tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary hover:tw-bg-interactive-hover"
        >
          <ArrowDown className="tw-size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
