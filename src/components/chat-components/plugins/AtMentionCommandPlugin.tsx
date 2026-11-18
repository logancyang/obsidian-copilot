import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
} from "@/components/chat-components/hooks/useAtMentionCategories";
import { useAtMentionSearch } from "@/components/chat-components/hooks/useAtMentionSearch";
import { agentMentionOptions } from "@/agents/ui/agentMentionOptions";
import { ChatAgentsContext, useMentionableAgents } from "@/agents/ui/chatAgents";
import { useLockedAgentMention } from "@/agents/ui/lockedCustomAgents";

interface AtMentionCommandPluginProps {
  showTools?: boolean;
  currentActiveFile?: TFile | null;
  isAgentMode?: boolean;
}

export function AtMentionCommandPlugin({
  showTools = false,
  currentActiveFile = null,
  isAgentMode = false,
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

  const allCategoryOptions = useAtMentionCategories(showTools);
  const lockedAgentMention = useLockedAgentMention(isAgentMode);
  const availableCategoryOptions = useMemo(() => {
    const categories = allCategoryOptions.filter((c) => !c.isAction);
    return lockedAgentMention?.option ? [...categories, lockedAgentMention.option] : categories;
  }, [allCategoryOptions, lockedAgentMention]);

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

  const contextResults = useAtMentionSearch(
    currentQuery,
    extendedState.mode,
    extendedState.selectedCategory,
    showTools,
    availableCategoryOptions,
    currentActiveFile
  );
  const mentionableAgents = useMentionableAgents();
  const { needsSetup, openProfile } = useContext(ChatAgentsContext);
  // Agents lead the menu's first level, above notes and the other context, and are not a category of their own.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  const searchResults = useMemo(
    () =>
      extendedState.mode === "category"
        ? [
            ...(lockedAgentMention
              ? agentMentionOptions(
                  lockedAgentMention.agents,
                  currentQuery,
                  () => "Supporter preview"
                )
              : agentMentionOptions(mentionableAgents, currentQuery, (agent) =>
                  needsSetup?.has(agent.slug) ? "Needs setup" : undefined
                )),
            ...contextResults,
          ]
        : contextResults,
    [
      extendedState.mode,
      lockedAgentMention,
      mentionableAgents,
      needsSetup,
      currentQuery,
      contextResults,
    ]
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

  const closeMenuRef = useRef(() => {});
  const handleSelect = useCallback(
    (option: CategoryOption | AtMentionOption) => {
      // The locked row opens the upsell and puts nothing in the message; it closes the menu itself because a license check that grants custom agents opens no dialog to take focus.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/582
      if (lockedAgentMention && option.lockedNote) {
        closeMenuRef.current();
        lockedAgentMention.choose();
        return;
      }
      // An agent whose model can't run on this device opens its profile, which says why and what to fix, instead of joining the message.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
      if (option.lockedNote && option.category === "customAgent" && isAtMentionOption(option)) {
        closeMenuRef.current();
        openProfile?.(option.data as string);
        return;
      }
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
    [
      lockedAgentMention,
      openProfile,
      extendedState.mode,
      currentQuery,
      isCategoryOption,
      isAtMentionOption,
      editor,
    ]
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

  const { state, handleHighlight, closeMenu } = useTypeaheadPlugin({
    triggerConfig: {
      char: "@",
      allowWhitespace: true,
    },
    options: searchResults,
    onSelect: handleSelect,
    onStateChange: onStateChangeCallback,
  });
  closeMenuRef.current = closeMenu;

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
