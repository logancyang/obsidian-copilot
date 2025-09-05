import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Helper function from smart-composer
function tryToPositionRange(leadOffset: number, range: Range, editorWindow: Window): boolean {
  const domSelection = editorWindow.getSelection();
  if (domSelection === null || !domSelection.isCollapsed) {
    return false;
  }
  const anchorNode = domSelection.anchorNode;
  const startOffset = leadOffset;
  const endOffset = domSelection.anchorOffset;

  if (anchorNode == null || endOffset == null) {
    return false;
  }

  try {
    range.setStart(anchorNode, startOffset);
    range.setEnd(anchorNode, endOffset);
  } catch {
    return false;
  }

  return true;
}

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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  // Calculate position relative to the document viewport for portal rendering
  const recalcPosition = useCallback(() => {
    if (!range) return;
    const rect = range.getBoundingClientRect();

    const menuWidth = menuRef.current?.offsetWidth || 384; // tw-max-w-96 => 384px
    const menuHeight = menuRef.current?.offsetHeight || 240; // tw-max-h-60 => 240px

    // Default: show ABOVE caret, positioned relative to viewport
    const desiredTop = rect.top - 4 - menuHeight;
    const desiredLeft = rect.left;

    // Clamp within viewport
    const minTop = 8; // small margin from top
    const maxTop = window.innerHeight - menuHeight - 8;
    const minLeft = 8; // small margin from left
    const maxLeft = window.innerWidth - menuWidth - 8;

    const top = Math.min(Math.max(desiredTop, minTop), maxTop);
    const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

    const newPosition = { top, left };
    console.log(
      `${menuLabel} position (viewport-relative)`,
      newPosition,
      "menu size:",
      { menuWidth, menuHeight },
      "range rect:",
      rect,
      "viewport:",
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPosition(newPosition);
  }, [range, menuLabel]);

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

  // Recalculate when the menu size could change
  useEffect(() => {
    recalcPosition();
  }, [options.length, selectedIndex, query, recalcPosition]);

  // Position the preview panel next to the menu on the left side (viewport-relative)
  const recalcPreview = useCallback(() => {
    if (!menuRef.current || !showPreview) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const itemRect = selectedItemRef.current?.getBoundingClientRect();

    const fixedWidth = 360; // fixed preview width
    const minHeight = 120; // minimum preview height
    const gutter = 8; // gap between preview and menu

    // Position preview to the left of the menu (viewport coordinates)
    // Right edge of preview should align with left edge of menu minus gutter
    const desiredLeft = menuRect.left - gutter - fixedWidth;

    // Vertically align to selected item if available, otherwise to menu top
    const desiredTop = itemRect ? itemRect.top : menuRect.top;

    // Clamp within viewport
    const minLeft = 8; // small margin from left edge
    const maxLeft = window.innerWidth - fixedWidth - 8;
    const minTop = 8; // small margin from top edge
    const maxTop = window.innerHeight - minHeight - 8;

    const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
    const top = Math.min(Math.max(desiredTop, minTop), maxTop);

    setPreviewPosition({ top, left });
  }, [showPreview]);

  useEffect(() => {
    if (showPreview) {
      recalcPreview();
    }
  }, [selectedIndex, options.length, position, recalcPreview, showPreview]);

  useEffect(() => {
    if (!showPreview) return;

    const handler = () => recalcPreview();
    // Listen for window resize and scroll events
    window.addEventListener("resize", handler);
    document.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      document.removeEventListener("scroll", handler);
    };
  }, [recalcPreview, showPreview]);

  // Scroll the selected item into view when selection changes
  useEffect(() => {
    if (selectedItemRef.current && menuRef.current) {
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

  const menu = (
    <div
      className={cn(
        "tw-absolute tw-max-h-60 tw-min-w-80 tw-max-w-96 tw-overflow-y-auto tw-rounded-lg tw-border tw-border-border tw-bg-primary tw-shadow-lg"
      )}
      style={{
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      ref={menuRef}
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
  );

  const preview =
    showPreview && previewPosition && options[selectedIndex]?.content ? (
      <div
        className={cn(
          "tw-overflow-hidden tw-rounded-md tw-border tw-border-border tw-bg-primary tw-shadow-lg"
        )}
        style={{
          position: "absolute",
          top: previewPosition.top ?? 0,
          left: previewPosition.left ?? 0,
          width: 360,
          minHeight: 120,
          maxHeight: 400,
          padding: 12,
          fontSize: "0.875rem",
          zIndex: 10000,
        }}
      >
        <div className="tw-mb-1 tw-text-xs tw-text-muted">Preview</div>
        <div className="tw-whitespace-pre-wrap tw-text-normal">
          {options[selectedIndex].content}
        </div>
      </div>
    ) : null;

  return (
    <>
      {createPortal(menu, document.body)}
      {preview && createPortal(preview, document.body)}
    </>
  );
};

export { tryToPositionRange };
export type { TypeaheadOption };
