import React, { useCallback, useState } from "react";
import { TFile, TFolder } from "obsidian";
import { TypeaheadMenuPopover } from "./TypeaheadMenuPopover";
import {
  useAtMentionCategories,
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
} from "./hooks/useAtMentionCategories";
import { useAtMentionSearch } from "./hooks/useAtMentionSearch";
import type { WebTabContext } from "@/types/message";

interface AtMentionTypeaheadProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    category: AtMentionCategory,
    data: TFile | string | TFolder | WebTabContext | null
  ) => void;
  showTools?: boolean;
  currentActiveFile?: TFile | null;
}

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
  showTools = false,
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
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevResultsLength, setPrevResultsLength] = useState(0);

  const availableCategoryOptions = useAtMentionCategories(showTools);

  const searchResults = useAtMentionSearch(
    searchQuery,
    extendedState.mode,
    extendedState.selectedCategory,
    showTools,
    availableCategoryOptions,
    currentActiveFile
  );

  const handleSelect = useCallback(
    (option: CategoryOption | AtMentionOption) => {
      if ((option as { disabled?: boolean })?.disabled) return;

      if (extendedState.mode === "category" && isCategoryOption(option) && !searchQuery) {
        if (option.isAction) {
          onSelect(option.category, null);
          onClose();
          return;
        }
        setExtendedState((prev) => ({
          ...prev,
          mode: "search",
          selectedCategory: option.category,
        }));
        setSearchQuery("");
        setSelectedIndex(0);
        return;
      }

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
          while (nextIndex < searchResults.length && searchResults[nextIndex]?.disabled) {
            nextIndex++;
          }
          if (nextIndex >= searchResults.length) {
            nextIndex = selectedIndex;
          }
          setSelectedIndex(nextIndex);
          break;
        }

        case "ArrowUp": {
          event.preventDefault();
          let prevIndex = selectedIndex - 1;
          while (prevIndex >= 0 && searchResults[prevIndex]?.disabled) {
            prevIndex--;
          }
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

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      setExtendedState({
        mode: "category",
        selectedCategory: undefined,
      });
    }
  }

  if (searchResults.length !== prevResultsLength) {
    setPrevResultsLength(searchResults.length);
    setSelectedIndex(0);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <TypeaheadMenuPopover
      options={searchResults}
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
