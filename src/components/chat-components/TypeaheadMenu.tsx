import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const MENU_WIDTH = 384;
const PREVIEW_MIN_HEIGHT = 120;
const PREVIEW_MAX_HEIGHT = 240;

interface TypeaheadOption {
  key: string;
  title: string;
  subtitle?: string;
  content?: string;
}

interface TypeaheadMenuProps {
  options: TypeaheadOption[];
  selectedIndex: number;
  onSelect: (option: TypeaheadOption) => void;
  onClose: () => void;
  onHighlight: (index: number) => void;
  range: Range | null;
  query: string;
  showPreview?: boolean;
  menuLabel?: string;
}

export const TypeaheadMenu: React.FC<TypeaheadMenuProps> = ({
  options,
  selectedIndex,
  onSelect,
  onClose,
  onHighlight,
  range,
  query,
  showPreview = false,
  menuLabel = "Options",
}) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  // Calculate position so menu stays in same spot regardless of preview visibility
  const recalcPosition = useCallback(() => {
    if (!range) return;
    const rect = range.getBoundingClientRect();

    const containerWidth = MENU_WIDTH;
    const menuHeight = 240; // max height estimate
    const previewHeight = PREVIEW_MAX_HEIGHT + 8; // preview + margin

    // Always position container as if preview is shown, so menu stays stable
    // This puts the menu in a consistent position regardless of preview visibility
    const desiredMenuTop = rect.top - 4 - menuHeight;
    const desiredContainerTop = desiredMenuTop - previewHeight;
    const desiredLeft = rect.left;

    // Clamp within viewport
    const totalHeight = previewHeight + menuHeight;
    const minTop = 8;
    const maxTop = window.innerHeight - totalHeight - 8;
    const minLeft = 8;
    const maxLeft = window.innerWidth - containerWidth - 8;

    const top = Math.min(Math.max(desiredContainerTop, minTop), maxTop);
    const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

    setPosition({ top, left });
  }, [range]);

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

  const container = (
    <div
      className="tw-absolute tw-z-[9999] tw-flex tw-flex-col"
      style={{
        top: position.top,
        left: position.left,
        width: MENU_WIDTH,
      }}
      ref={containerRef}
    >
      {/* Preview area - always takes same total space */}
      <div
        className="tw-mb-2 tw-flex tw-shrink-0 tw-flex-col"
        style={{ height: PREVIEW_MAX_HEIGHT }}
      >
        {/* Flexible spacer to fill remaining space */}
        <div className="tw-flex-1" />
        {showPreview && options[selectedIndex]?.content && (
          <div
            className={cn(
              "tw-shrink-0 tw-overflow-hidden tw-rounded-md tw-bg-primary tw-p-3 tw-text-sm tw-shadow-xl"
            )}
            style={{
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
      </div>

      {/* Menu */}
      <div
        className={cn(
          "tw-max-h-60 tw-shrink-0 tw-overflow-y-auto tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg"
        )}
      >
        <div className="tw-p-2 tw-text-normal">
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
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
                <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
                  <div className="tw-truncate tw-font-medium tw-text-normal">{option.title}</div>
                  {option.subtitle && (
                    <div className="tw-truncate tw-text-xs tw-text-muted">{option.subtitle}</div>
                  )}
                </div>
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
