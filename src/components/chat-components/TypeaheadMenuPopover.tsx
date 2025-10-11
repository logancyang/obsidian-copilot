import React from "react";
import { TypeaheadMenuContent, TypeaheadOption } from "./TypeaheadMenuContent";

interface TypeaheadMenuPopoverProps {
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
}

export function TypeaheadMenuPopover({
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
}: TypeaheadMenuPopoverProps) {
  return (
    <TypeaheadMenuContent
      options={options}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onHighlight={onHighlight}
      query={query}
      mode={mode}
      showPreview={showPreview}
      searchBarMode={searchBarMode}
      searchQuery={searchQuery}
      onSearchChange={onSearchChange}
      onKeyDown={onKeyDown}
    />
  );
}
