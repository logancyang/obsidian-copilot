import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TypeaheadMenuContent, TypeaheadOption } from "./TypeaheadMenuContent";

/**
 * Creates a DOM Range from a trigger character position to the current cursor position.
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

const MENU_WIDTH = 400;
const MAX_WIDTH_PERCENTAGE = 0.9;

interface TypeaheadMenuPortalProps {
  options: TypeaheadOption[];
  selectedIndex: number;
  onSelect: (option: TypeaheadOption) => void;
  onHighlight: (index: number) => void;
  range: Range | null;
  query: string;
  showPreview?: boolean;
  mode?: "category" | "search";
  onKeyDown?: (event: React.KeyboardEvent) => void;
}

export function TypeaheadMenuPortal({
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  range,
  query,
  showPreview = false,
  mode = "search",
  onKeyDown,
}: TypeaheadMenuPortalProps) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  // Calculate dynamic width based on content
  const calculateWidth = useCallback(() => {
    const maxAllowedWidth = Math.floor(window.innerWidth * MAX_WIDTH_PERCENTAGE);

    if (options.length === 0) return Math.min(MENU_WIDTH, maxAllowedWidth);

    const maxTitleLength = Math.max(...options.map((opt) => opt.title.length));
    const maxSubtitleLength = Math.max(...options.map((opt) => opt.subtitle?.length || 0));

    const estimatedWidth = Math.max(maxTitleLength * 8 + 32, maxSubtitleLength * 6 + 32);
    const preferredWidth = Math.min(Math.max(estimatedWidth, 300), MENU_WIDTH);

    return Math.min(preferredWidth, maxAllowedWidth);
  }, [options]);

  // Positioning for text-triggered menus
  const recalcPosition = useCallback(() => {
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const containerWidth = calculateWidth();

    const top = rect.top - 4;
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
    window.addEventListener("resize", handler);
    document.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      document.removeEventListener("scroll", handler);
    };
  }, [recalcPosition]);

  if (!position || options.length === 0) {
    return null;
  }

  const container = (
    <div
      className="tw-absolute tw-z-[9999] tw-flex tw-flex-col tw-items-end"
      style={{
        bottom: `calc(100vh - ${position.top}px)`,
        left: position.left,
        width: position.width,
      }}
    >
      <TypeaheadMenuContent
        options={options}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        onHighlight={onHighlight}
        query={query}
        mode={mode}
        showPreview={showPreview}
        onKeyDown={onKeyDown}
        className="tw-shadow-lg"
        width={position.width}
      />
    </div>
  );

  return createPortal(container, document.body);
}

export { tryToPositionRange };
