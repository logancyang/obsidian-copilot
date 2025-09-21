import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Creates a DOM Range from a trigger character position to the current cursor position.
 *
 * @param leadOffset - The character offset where the trigger (like '[' or '/') was found
 * @param editorWindow - The window containing the editor
 * @returns Range object if successfully positioned, null if positioning failed
 *
 * Positioning can fail when:
 * - User has text selected (non-collapsed selection)
 * - No DOM selection exists
 * - Cursor is not in a text node
 * - Range boundaries would be invalid (offset out of bounds, node removed, etc.)
 *
 * When this returns null, the calling plugin should not display its menu to prevent
 * broken UI states.
 */
function tryToPositionRange(leadOffset: number, editorWindow: Window): Range | null {
  const domSelection = editorWindow.getSelection();
  if (domSelection === null || !domSelection.isCollapsed) {
    return null;
  }
  const anchorNode = domSelection.anchorNode;
  const startOffset = leadOffset;
  const endOffset = domSelection.anchorOffset;

  if (anchorNode == null || endOffset == null) {
    return null;
  }

  const range = editorWindow.document.createRange();

  try {
    range.setStart(anchorNode, startOffset);
    range.setEnd(anchorNode, endOffset);
  } catch {
    return null;
  }

  return range;
}

const MENU_MIN_WIDTH = 320;
const MENU_MAX_WIDTH = 320;
const PREVIEW_MIN_HEIGHT = 120;
const PREVIEW_MAX_HEIGHT = 240;

interface TypeaheadOption {
  key: string;
  title: string;
  subtitle?: string;
  content?: string;
  category?: string;
  icon?: React.ReactNode;
}

interface TypeaheadMenuProps<T extends TypeaheadOption = TypeaheadOption> {
  options: T[];
  selectedIndex: number;
  onSelect: (option: T) => void;
  onClose: () => void;
  onHighlight: (index: number) => void;
  range: Range | null;
  query: string;
  showPreview?: boolean;
  menuLabel?: string;
  mode?: "category" | "search";
}

export const TypeaheadMenu = <T extends TypeaheadOption = TypeaheadOption>({
  options,
  selectedIndex,
  onSelect,
  onClose,
  onHighlight,
  range,
  query,
  showPreview = false,
  menuLabel = "Options",
  mode = "search",
}: TypeaheadMenuProps<T>) => {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  // Calculate dynamic width based on content
  const calculateWidth = useCallback(() => {
    if (options.length === 0) return MENU_MIN_WIDTH;

    // Estimate width based on content length
    const maxTitleLength = Math.max(...options.map((opt) => opt.title.length));
    const maxSubtitleLength = Math.max(...options.map((opt) => opt.subtitle?.length || 0));

    // Base width calculation (rough estimate: 8px per character + padding)
    const estimatedWidth = Math.max(
      maxTitleLength * 8 + 32, // title + padding
      maxSubtitleLength * 6 + 32 // subtitle (smaller font) + padding
    );

    return Math.min(Math.max(estimatedWidth, MENU_MIN_WIDTH), MENU_MAX_WIDTH);
  }, [options]);

  // Simple positioning: place container bottom right above text range
  const recalcPosition = useCallback(() => {
    if (!range) return;
    const rect = range.getBoundingClientRect();

    const containerWidth = calculateWidth();

    // Simple positioning: container bottom aligns with range top
    const top = rect.top - 4; // Small gap above range

    // Clamp horizontal position
    const minLeft = 8;
    const maxLeft = window.innerWidth - containerWidth - 8;
    const left = Math.min(Math.max(rect.left, minLeft), maxLeft);

    setPosition({
      top,
      left,
      width: containerWidth,
    });
  }, [range, calculateWidth]);

  useEffect(() => {
    recalcPosition();
  }, [recalcPosition]);

  useEffect(() => {
    const handler = () => recalcPosition();
    // Listen for window resize and scroll events on the document
    window.addEventListener("resize", handler);
    document.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      document.removeEventListener("scroll", handler);
    };
  }, [recalcPosition]);

  // Recalculate when the container content could change
  useEffect(() => {
    recalcPosition();
  }, [options.length, selectedIndex, query, recalcPosition]);

  // Scroll the selected item into view when selection changes
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  if (!position || options.length === 0) {
    return null;
  }

  const hasPreview = showPreview && options[selectedIndex]?.content;

  const container = (
    <div
      className="tw-absolute tw-z-[9999] tw-flex tw-flex-col tw-items-end"
      style={{
        bottom: `calc(100vh - ${position.top}px)`,
        left: position.left,
        width: position.width,
      }}
      ref={containerRef}
    >
      {/* Preview */}
      {hasPreview && (
        <div
          className="tw-mb-2 tw-overflow-hidden tw-rounded-md tw-bg-primary tw-p-3 tw-text-sm tw-shadow-xl"
          style={{
            width: position.width,
            minHeight: PREVIEW_MIN_HEIGHT,
            maxHeight: PREVIEW_MAX_HEIGHT,
          }}
        >
          <div className="tw-mb-1 tw-text-xs tw-text-muted">Preview</div>
          <div className="tw-whitespace-pre-wrap tw-text-normal">
            {options[selectedIndex].content}
          </div>
        </div>
      )}

      {/* Menu */}
      <div
        className="tw-overflow-y-auto tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg"
        style={{
          width: position.width,
          minHeight: Math.min(options.length * 44 + 16, 100), // At least show content
          maxHeight: 240,
        }}
      >
        <div className="tw-p-2 tw-text-normal">
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isCategory = mode === "category" && !query && option.icon;

            return (
              <div
                key={option.key}
                ref={isSelected ? selectedItemRef : undefined}
                className={cn(
                  "tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-text-normal",
                  isSelected ? "tw-bg-secondary" : "hover:tw-bg-secondary"
                )}
                onClick={() => onSelect(option)}
                onMouseEnter={() => onHighlight(index)}
              >
                {isCategory ? (
                  <div className="tw-flex tw-w-full tw-items-center tw-justify-between">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      {option.icon}
                      <span className="tw-font-medium">{option.title}</span>
                    </div>
                    <ChevronRight className="tw-size-4 tw-text-muted" />
                  </div>
                ) : (
                  <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
                    {option.icon && (
                      <div className="tw-flex tw-h-full tw-shrink-0 tw-items-center">
                        {option.icon}
                      </div>
                    )}
                    <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
                      <div className="tw-truncate tw-font-medium tw-text-normal">
                        {option.title}
                      </div>
                      {option.subtitle && (
                        <div className="tw-truncate tw-text-xs tw-text-muted">
                          {option.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return createPortal(container, document.body);
};

export { tryToPositionRange };
export type { TypeaheadOption };
