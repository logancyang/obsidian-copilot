import React, { useRef, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TypeaheadOption {
  key: string;
  title: string;
  subtitle?: string;
  content?: string;
  category?: string;
  icon?: React.ReactNode;
}

interface TypeaheadMenuContentProps {
  options: TypeaheadOption[];
  selectedIndex: number;
  onSelect: (option: TypeaheadOption) => void;
  onHighlight: (index: number) => void;
  query?: string;
  mode?: "category" | "search";
  showPreview?: boolean;
  searchBarMode?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  className?: string;
  width?: number;
}

const PREVIEW_MIN_HEIGHT = 120;
const PREVIEW_MAX_HEIGHT = 240;

export function TypeaheadMenuContent({
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  query = "",
  mode = "search",
  showPreview = false,
  searchBarMode = false,
  searchQuery = "",
  onSearchChange,
  onKeyDown,
  className,
  width,
}: TypeaheadMenuContentProps) {
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    onSearchChange?.(newQuery);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle keyboard navigation in search input
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === "Tab" ||
      e.key === "Escape"
    ) {
      e.preventDefault();
      onKeyDown?.(e);
    }
  };

  const hasPreview = showPreview && options[selectedIndex]?.content;

  return (
    <div className={cn("tw-flex tw-flex-col", className)}>
      {/* Preview */}
      {hasPreview && (
        <div
          className="tw-mb-2 tw-overflow-hidden tw-rounded-md tw-bg-primary tw-p-3 tw-text-sm tw-shadow-xl"
          style={{
            minHeight: PREVIEW_MIN_HEIGHT,
            maxHeight: PREVIEW_MAX_HEIGHT,
            ...(width && { width }),
          }}
        >
          <div className="tw-mb-1 tw-text-xs tw-text-muted">Preview</div>
          {options[selectedIndex].subtitle && (
            <div className="tw-mb-2 tw-text-xs tw-text-muted">
              {options[selectedIndex].subtitle}
            </div>
          )}
          <div className="tw-whitespace-pre-wrap tw-text-normal">
            {options[selectedIndex].content}
          </div>
        </div>
      )}

      {/* Menu */}
      <div
        className="tw-overflow-hidden tw-rounded-lg tw-bg-primary"
        style={{
          ...(width && { width }),
        }}
      >
        {/* Options List */}
        <div
          className="tw-overflow-y-auto"
          style={{
            minHeight: Math.min(options.length * 44 + 16, 100),
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
                    isSelected ? "tw-bg-modifier-hover" : "hover:tw-bg-modifier-hover"
                  )}
                  // Use onMouseDown instead of onClick to prevent triggering
                  // onblur events of the typeahead menu
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(option);
                  }}
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

        {/* Search Bar - integrated at bottom of menu */}
        {searchBarMode && (
          <div className="tw-border-t tw-border-solid tw-border-border tw-p-0.5">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              autoFocus
              className="tw-w-full tw-rounded-md !tw-border-none !tw-bg-transparent tw-px-1 tw-py-0 tw-text-sm tw-text-normal placeholder:tw-text-muted focus:!tw-shadow-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
