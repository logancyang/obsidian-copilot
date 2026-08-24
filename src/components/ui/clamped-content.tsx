import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import React, { useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Line height assumed when the computed `line-height` is not a length, which is
 * what `normal` resolves to whenever no ancestor sets one. Without it every
 * comparison against `NaN` is false, so the clamp would silently never engage
 * and oversized content would render at full height.
 */
const FALLBACK_LINE_HEIGHT_PX = 20;

export interface ClampedContentProps {
  /**
   * How many lines stay visible while collapsed. The pixel cap is derived from
   * the content's own computed `line-height`, so the clamp tracks the reader's
   * font size rather than freezing at one theme's metrics.
   */
  collapsedLines: number;
  children: React.ReactNode;
}

/**
 * Clips content taller than `collapsedLines` and offers an explicit expand and
 * collapse control, so a single oversized block cannot bury what surrounds it.
 * Content that already fits renders untouched and shows no control.
 */
export const ClampedContent: React.FC<ClampedContentProps> = ({ collapsedLines, children }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // `null` means the content fits, which is also the state that hides the toggle.
  const [clampHeightPx, setClampHeightPx] = useState<number | null>(null);
  const contentId = useId();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      // Read styles through the element's own realm: chat also renders inside
      // Obsidian popout windows, where the ambient `window` is a different one.
      const view = content.ownerDocument.defaultView;
      const lineHeightPx = view
        ? Number.parseFloat(view.getComputedStyle(content).lineHeight)
        : Number.NaN;
      const limitPx =
        (Number.isFinite(lineHeightPx) ? lineHeightPx : FALLBACK_LINE_HEIGHT_PX) * collapsedLines;
      setClampHeightPx(content.scrollHeight > limitPx ? limitPx : null);
    };

    measure();

    // Guard for test/JSDOM environments where ResizeObserver may not exist.
    if (typeof ResizeObserver === "undefined") return;
    // Reflow from a resized pane, a loaded image, or a font change can move
    // content across the threshold in either direction after the first paint.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [collapsedLines]);

  const isClamped = clampHeightPx !== null && !isExpanded;

  return (
    <div className="tw-flex tw-flex-col">
      <div
        id={contentId}
        data-testid="clamped-content"
        className="tw-overflow-hidden"
        style={isClamped ? { maxHeight: `${clampHeightPx}px` } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {clampHeightPx !== null && (
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
