import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TFile } from "obsidian";
import { useApp } from "@/context";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { useTypeaheadPlugin } from "@/components/chat-components/hooks/useTypeaheadPlugin";
import {
  $replaceTriggeredTextWithPill,
  PillData,
} from "@/components/chat-components/utils/lexicalTextUtils";
import {
  useAtMentionCategories,
  AgentMentionBrand,
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
  EMPTY_AGENT_MENTION_BRANDS,
} from "@/components/chat-components/hooks/useAtMentionCategories";
import { useAtMentionSearch } from "@/components/chat-components/hooks/useAtMentionSearch";

interface AtMentionCommandPluginProps {
  showTools?: boolean;
  currentActiveFile?: TFile | null;
  agentBrands?: ReadonlyArray<AgentMentionBrand>;
}

export function AtMentionCommandPlugin({
  showTools = false,
  currentActiveFile = null,
  agentBrands = EMPTY_AGENT_MENTION_BRANDS,
}: AtMentionCommandPluginProps): JSX.Element {
  const app = useApp();
  const [editor] = useLexicalComposerContext();
  const [extendedState, setExtendedState] = useState<{
    mode: "category" | "search";
    selectedCategory?: AtMentionCategory;
  }>({
    mode: "category",
  });

  const [currentPreviewContent, setCurrentPreviewContent] = useState<string>("");

  const allCategoryOptions = useAtMentionCategories(showTools, agentBrands.length > 0);
  const availableCategoryOptions = useMemo(
    () => allCategoryOptions.filter((c) => !c.isAction),
    [allCategoryOptions]
  );

  const loadNoteContentForPreview = useCallback(
    async (file: TFile | null) => {
      if (!file) {
        setCurrentPreviewContent("");
        return;
      }
      try {
        if (file.extension === "pdf" || file.extension === "canvas") {
          setCurrentPreviewContent("");
          return;
        }

        const content = await app.vault.cachedRead(file);
        const contentWithoutFrontmatter = content
          .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
          .trim();
        const truncatedContent =
          contentWithoutFrontmatter.length > 300
            ? contentWithoutFrontmatter.slice(0, 300) + "..."
            : contentWithoutFrontmatter;

        setCurrentPreviewContent(truncatedContent);
      } catch {
        setCurrentPreviewContent("Failed to load content");
      }
    },
    [app]
  );

  const [currentQuery, setCurrentQuery] = useState("");

  const searchResults = useAtMentionSearch(
    currentQuery,
    extendedState.mode,
    extendedState.selectedCategory,
    showTools,
    availableCategoryOptions,
    currentActiveFile,
    agentBrands
  );

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

  const handleSelect = useCallback(
    (option: CategoryOption | AtMentionOption) => {
      if (extendedState.mode === "category" && isCategoryOption(option) && !currentQuery) {
        setExtendedState((prev) => ({
          ...prev,
          mode: "search",
          selectedCategory: option.category,
        }));
        return;
      }

      if (isAtMentionOption(option)) {
        if (option.category === "activeNote") {
          editor.update(() => {
            $replaceTriggeredTextWithPill("@", { type: "active-note" });
          });
        } else if (!option.isAction) {
          const pillData: PillData = {
            type: option.category as PillData["type"],
            title: option.title,
            data: option.data,
          };

          editor.update(() => {
            $replaceTriggeredTextWithPill("@", pillData);
          });
        }
      }
    },
    [extendedState.mode, currentQuery, isCategoryOption, isAtMentionOption, editor]
  );

  const onStateChangeCallback = useCallback((newState: { query: string; isOpen: boolean }) => {
    setCurrentQuery(newState.query);
    if (!newState.isOpen) {
      setExtendedState({
        mode: "category",
        selectedCategory: undefined,
      });
    }
  }, []);

  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "@",
      allowWhitespace: true,
    },
    options: searchResults,
    onSelect: handleSelect,
    onStateChange: onStateChangeCallback,
  });

  const selectedFile = useMemo<TFile | null>(() => {
    const selectedOption = searchResults[state.selectedIndex];
    if (
      selectedOption &&
      isAtMentionOption(selectedOption) &&
      selectedOption.category === "notes" &&
      selectedOption.data instanceof TFile
    ) {
      return selectedOption.data;
    }
    return null;
  }, [state.selectedIndex, searchResults, isAtMentionOption]);

  useEffect(() => {
    void loadNoteContentForPreview(selectedFile);
  }, [selectedFile, loadNoteContentForPreview]);

  const displayOptions = useMemo(() => {
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
          options={displayOptions}
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
