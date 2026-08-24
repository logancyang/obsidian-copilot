import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import React, { useId, useLayoutEffect, useRef, useState } from "react";

const OVERFLOW_TOLERANCE_PX = 1;

export interface ClampedContentProps {
  /**
   * CSS class that caps the content while collapsed. Keep the class literal at
   * the call site so Tailwind can generate it.
   */
  collapsedClassName: string;
  children: React.ReactNode;
}

/**
 * Clips overflowing content and offers an explicit expand and collapse control.
 *
 * @param props - Content and the CSS class that defines its collapsed cap.
 * @param props.children - Content that may need to be collapsed.
 * @param props.collapsedClassName - CSS class applied while the content is collapsed.
 */
export const ClampedContent: React.FC<ClampedContentProps> = ({ collapsedClassName, children }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentId = useId();

  useLayoutEffect(() => {
    const content = contentRef.current;
    // Expanded content has no height cap, so measuring it would hide the control
    // needed to collapse it again: https://github.com/Brevilabs/obsidian-copilot-private/issues/151
    if (!content || isExpanded) return;

    const measure = () => {
      setIsOverflowing(content.scrollHeight > content.clientHeight + OVERFLOW_TOLERANCE_PX);
    };

    measure();

    const ResizeObserverConstructor = content.doc.defaultView?.ResizeObserver;
    const observer = ResizeObserverConstructor ? new ResizeObserverConstructor(measure) : null;
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [collapsedClassName, isExpanded]);

  const isClamped = isOverflowing && !isExpanded;

  return (
    <div className="tw-flex tw-flex-col">
      <div
        ref={contentRef}
        id={contentId}
        data-testid="clamped-content"
        className={cn("tw-overflow-hidden", !isExpanded && collapsedClassName)}
      >
        {children}
      </div>
      {isOverflowing && (
        <div className="tw-flex tw-flex-col tw-items-start tw-pt-1">
          {isClamped && (
            <div aria-hidden className="tw-select-none tw-text-muted">
              ...
            </div>
          )}
          <Button
            variant="ghost2"
            size="fit"
            aria-controls={contentId}
            aria-expanded={isExpanded}
            className="tw--ml-1 tw-py-1"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {isExpanded ? "Show less" : "Show more"}
            {isExpanded ? (
              <ChevronUp className="tw-size-icon-xs" />
            ) : (
              <ChevronDown className="tw-size-icon-xs" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
