import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import React, { useId, useLayoutEffect, useRef, useState } from "react";

export interface CollapsibleUserTextProps {
  children: React.ReactNode;
}

interface ResizeObserverWindow extends Window {
  ResizeObserver?: typeof ResizeObserver;
}

/** Keeps an overflowing user prompt compact without removing any of its text from the document. */
export function CollapsibleUserText({ children }: CollapsibleUserTextProps) {
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || isExpanded) return;

    // Rendered height, rather than character count, catches both pasted logs and
    // wrapping in narrow panes while leaving normal prompts alone.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/151
    const updateOverflow = () => {
      setIsOverflowing(content.scrollHeight > content.clientHeight);
    };

    updateOverflow();

    const ResizeObserverCtor = (content.win as ResizeObserverWindow).ResizeObserver;
    if (ResizeObserverCtor === undefined) return;

    const observer = new ResizeObserverCtor(updateOverflow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [children, isExpanded]);

  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-items-start">
      <div
        ref={contentRef}
        id={contentId}
        className={cn("tw-w-full", !isExpanded && "tw-max-h-40 tw-overflow-hidden")}
      >
        {children}
      </div>
      {isOverflowing ? (
        <Button
          type="button"
          variant="ghost2"
          size="fit"
          className="tw-mt-1 tw-h-auto tw-px-0 tw-text-accent"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? (
            <>
              Show less <ChevronUp className="tw-size-3" aria-hidden="true" />
            </>
          ) : (
            <>
              Show more <ChevronDown className="tw-size-3" aria-hidden="true" />
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}
