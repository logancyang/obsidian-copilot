import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TFile, App } from "obsidian";
import { TypeaheadMenuPortal } from "../TypeaheadMenuPortal";
import { useTypeaheadPlugin } from "../hooks/useTypeaheadPlugin";
import { $replaceTriggeredTextWithPill, PillData } from "../utils/lexicalTextUtils";
import {
  useAtMentionCategories,
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
} from "../hooks/useAtMentionCategories";
import { useAtMentionSearch } from "../hooks/useAtMentionSearch";

// Get app instance
declare const app: App;

interface AtMentionCommandPluginProps {
  isCopilotPlus?: boolean;
}

export function AtMentionCommandPlugin({
  isCopilotPlus = false,
}: AtMentionCommandPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [extendedState, setExtendedState] = useState<{
    mode: "category" | "search";
    selectedCategory?: AtMentionCategory;
  }>({
    mode: "category",
  });

  // State to track preview content for the currently highlighted note
  const [currentPreviewContent, setCurrentPreviewContent] = useState<string>("");

  // Use the shared at-mention categories hook
  const availableCategoryOptions = useAtMentionCategories(isCopilotPlus);

  // Load note content for preview using shared utilities
  const loadNoteContentForPreview = useCallback(async (file: TFile) => {
    try {
      // Handle PDF files - treat as empty content (no preview)
      if (file.extension === "pdf") {
        setCurrentPreviewContent("");
        return;
      }

      const content = await app.vault.cachedRead(file);
      const contentWithoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
      const truncatedContent =
        contentWithoutFrontmatter.length > 300
          ? contentWithoutFrontmatter.slice(0, 300) + "..."
          : contentWithoutFrontmatter;

      setCurrentPreviewContent(truncatedContent);
    } catch {
      setCurrentPreviewContent("Failed to load content");
    }
  }, []);

  // Temporary state for query to resolve circular dependency
  const [currentQuery, setCurrentQuery] = useState("");

  // Get search results using the unified search hook
  const searchResults = useAtMentionSearch(
    currentQuery,
    extendedState.mode,
    extendedState.selectedCategory,
    isCopilotPlus,
    availableCategoryOptions
  );

  // Type guard functions
  const isAtMentionOption = useCallback(
    (option: CategoryOption | AtMentionOption): option is AtMentionOption => {
      return "data" in option;
    },
    []
  );

  const isCategoryOption = useCallback(
    (option: CategoryOption | AtMentionOption): option is CategoryOption => {
      return "icon" in option && !("data" in option);
    },
    []
  );

  // Selection handler
  const handleSelect = useCallback(
    (option: any) => {
      if (extendedState.mode === "category" && isCategoryOption(option) && !currentQuery) {
        // Category was selected - switch to search mode for that category
        setExtendedState((prev) => ({
          ...prev,
          mode: "search",
          selectedCategory: option.category,
        }));
        return;
      }

      // Item was selected - create appropriate pill using shared utility
      if (isAtMentionOption(option)) {
        const pillData: PillData = {
          type: option.category,
          title: option.title,
          data: option.data,
        };

        editor.update(() => {
          $replaceTriggeredTextWithPill("@", pillData);
        });
      }
    },
    [extendedState.mode, currentQuery, isCategoryOption, isAtMentionOption, editor]
  );

  const onStateChangeCallback = useCallback((newState: any) => {
    setCurrentQuery(newState.query);
    // Reset to category mode when menu closes
    if (!newState.isOpen) {
      setExtendedState({
        mode: "category",
        selectedCategory: undefined,
      });
    }
  }, []);

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "@",
    },
    options: searchResults,
    onSelect: handleSelect,
    onStateChange: onStateChangeCallback,
  });

  // Load preview content when selection changes
  useEffect(() => {
    const selectedOption = searchResults[state.selectedIndex];
    if (
      selectedOption &&
      isAtMentionOption(selectedOption) &&
      selectedOption.category === "notes" &&
      selectedOption.data instanceof TFile
    ) {
      loadNoteContentForPreview(selectedOption.data);
    } else {
      setCurrentPreviewContent("");
    }
  }, [state.selectedIndex, searchResults, isAtMentionOption, loadNoteContentForPreview]);

  // Create display options with preview content for the highlighted note
  const displayOptions = useMemo(() => {
    // Add preview content to the currently highlighted option if it's a note
    return searchResults.map((option, index) => {
      if (
        index === state.selectedIndex &&
        isAtMentionOption(option) &&
        option.category === "notes" &&
        option.data instanceof TFile
      ) {
        return {
          ...option,
          content: currentPreviewContent,
        };
      }
      return option;
    });
  }, [searchResults, state.selectedIndex, currentPreviewContent, isAtMentionOption]);

  return (
    <>
      {state.isOpen && (
        <TypeaheadMenuPortal
          options={displayOptions as any[]}
          selectedIndex={state.selectedIndex}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          range={state.range}
          query={state.query}
          showPreview={
            searchResults[state.selectedIndex] &&
            isAtMentionOption(searchResults[state.selectedIndex]) &&
            searchResults[state.selectedIndex].category === "notes"
          }
          mode={extendedState.mode}
        />
      )}
    </>
  );
}
