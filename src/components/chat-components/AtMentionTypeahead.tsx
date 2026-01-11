import React, { useCallback, useEffect, useState } from "react";
import { TFile } from "obsidian";
import { TypeaheadMenuPopover } from "./TypeaheadMenuPopover";
import {
  useAtMentionCategories,
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
} from "./hooks/useAtMentionCategories";
import { useAtMentionSearch } from "./hooks/useAtMentionSearch";

interface AtMentionTypeaheadProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (category: AtMentionCategory, data: any) => void;
  isCopilotPlus?: boolean;
  currentActiveFile?: TFile | null;
}

// Type guard functions
function isAtMentionOption(option: CategoryOption | AtMentionOption): option is AtMentionOption {
  return "data" in option;
}

function isCategoryOption(option: CategoryOption | AtMentionOption): option is CategoryOption {
  return "icon" in option && !("data" in option);
}

export function AtMentionTypeahead({
  isOpen,
  onClose,
  onSelect,
  isCopilotPlus = false,
  currentActiveFile = null,
}: AtMentionTypeaheadProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [extendedState, setExtendedState] = useState<{
    mode: "category" | "search";
    selectedCategory?: AtMentionCategory;
  }>({
    mode: "category",
  });

  const availableCategoryOptions = useAtMentionCategories(isCopilotPlus);

  // Get search results based on current state using unified search
  const searchResults = useAtMentionSearch(
    searchQuery,
    extendedState.mode,
    extendedState.selectedCategory,
    isCopilotPlus,
    availableCategoryOptions,
    currentActiveFile
  );

  // Handle selection
  const handleSelect = useCallback(
    (option: any) => {
      // Guard: never select disabled options (defensive check for click events)
      if (option?.disabled) return;

      if (extendedState.mode === "category" && isCategoryOption(option) && !searchQuery) {
        // Category was selected - switch to search mode for that category
        setExtendedState((prev) => ({
          ...prev,
          mode: "search",
          selectedCategory: option.category,
        }));
        setSearchQuery("");
        setSelectedIndex(0);
        return;
      }

      // Item was selected - notify parent
      if (isAtMentionOption(option)) {
        onSelect(option.category, option.data);
        onClose();
      }
    },
    [extendedState.mode, searchQuery, onSelect, onClose]
  );

  const handleHighlight = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          let nextIndex = selectedIndex + 1;
          // Skip disabled options
          while (nextIndex < searchResults.length && searchResults[nextIndex]?.disabled) {
            nextIndex++;
          }
          // If no valid option found, stay at current position
          if (nextIndex >= searchResults.length) {
            nextIndex = selectedIndex;
          }
          setSelectedIndex(nextIndex);
          break;
        }

        case "ArrowUp": {
          event.preventDefault();
          let prevIndex = selectedIndex - 1;
          // Skip disabled options
          while (prevIndex >= 0 && searchResults[prevIndex]?.disabled) {
            prevIndex--;
          }
          // If no valid option found, stay at current position
          if (prevIndex < 0) {
            prevIndex = selectedIndex;
          }
          setSelectedIndex(prevIndex);
          break;
        }

        case "Enter":
        case "Tab": {
          event.preventDefault();
          const currentOption = searchResults[selectedIndex];
          // Don't select disabled options
          if (currentOption?.disabled) {
            break;
          }
          if (currentOption) {
            handleSelect(currentOption);
          }
          break;
        }

        case "Escape": {
          event.preventDefault();
          onClose();
          break;
        }

        case "Backspace": {
          // Handle backspace in category mode to go back to categories
          if (extendedState.mode === "search" && !searchQuery) {
            event.preventDefault();
            setExtendedState({
              mode: "category",
              selectedCategory: undefined,
            });
            setSelectedIndex(0);
          }
          break;
        }
      }
    },
    [selectedIndex, searchResults, handleSelect, onClose, extendedState.mode, searchQuery]
  );

  // Reset state when menu closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      setExtendedState({
        mode: "category",
        selectedCategory: undefined,
      });
    }
  }, [isOpen]);

  // Reset selected index when options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults.length]);

  if (!isOpen) {
    return null;
  }

  return (
    <TypeaheadMenuPopover
      options={searchResults as any[]}
      selectedIndex={selectedIndex}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      query={searchQuery}
      mode={extendedState.mode}
      showPreview={false}
      searchBarMode={true}
      searchQuery={searchQuery}
      onSearchChange={handleSearchChange}
      onKeyDown={handleKeyDown}
    />
  );
}
