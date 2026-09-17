import React, { useMemo } from "react";
import { TFolder, TFile } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { FileText, Wrench, Folder, FileClock, Globe, CircleDashed, Plus } from "lucide-react";
import fuzzysort from "fuzzysort";
import { getToolDescription } from "@/tools/toolManager";
import { AVAILABLE_TOOLS } from "@/components/chat-components/constants/tools";
import { useAllNotes } from "./useAllNotes";
import { useAllFolders } from "./useAllFolders";
import { useOpenWebTabs } from "./useOpenWebTabs";
import { useActiveWebTabState } from "./useActiveWebTabState";
import {
  AgentMentionState,
  AtMentionCategory,
  AtMentionOption,
  CategoryOption,
  NO_AGENT_MENTIONS,
} from "./useAtMentionCategories";
import { getEffectiveCustomPromptsFolder } from "@/settings/copilotFolder";
import { AgentGlyph } from "@/agents/ui/AgentGlyph";

/**
 * Key of the row a user with no agents gets in place of a mention list. Selecting
 * it opens Settings → Agents rather than inserting a pill
 * (`designdocs/CUSTOM_AGENTS.md` §6).
 */
export const CREATE_AGENT_OPTION_KEY = "agent-create";

const MAX_SEARCH_RESULTS = 30;

export function useAtMentionSearch(
  query: string,
  mode: "category" | "search",
  selectedCategory: AtMentionCategory | undefined,
  isCopilotPlus: boolean,
  showTools: boolean,
  availableCategoryOptions: CategoryOption[],
  currentActiveFile: TFile | null = null,
  agentMentions: AgentMentionState = NO_AGENT_MENTIONS
): (CategoryOption | AtMentionOption)[] {
  const allNotes = useAllNotes(isCopilotPlus);
  const allFolders = useAllFolders();

  const shouldEnableWebTabPolling =
    isDesktopRuntime() &&
    ((mode === "category" && query.trim().length > 0) ||
      (mode === "search" && selectedCategory === "webTabs"));
  const openWebTabs = useOpenWebTabs({ enabled: shouldEnableWebTabPolling });

  const { activeWebTabForMentions: activeWebTab } = useActiveWebTabState();

  const noteItems: AtMentionOption[] = useMemo(
    () =>
      allNotes.map((file, index) => ({
        key: `note-${file.basename}-${index}`,
        title: file.basename,
        subtitle: file.path,
        category: "notes",
        data: file,
        content: undefined,
        icon: React.createElement(FileText, { className: "tw-size-4" }),
        searchKeyword: file.path,
      })),
    [allNotes]
  );

  const toolItems: AtMentionOption[] = useMemo(
    () =>
      showTools
        ? AVAILABLE_TOOLS.map((tool) => ({
            key: `tool-${tool}`,
            title: tool,
            subtitle: getToolDescription(tool),
            category: "tools",
            data: tool,
            content: getToolDescription(tool),
            icon: React.createElement(Wrench, { className: "tw-size-4" }),
          }))
        : [],
    [showTools]
  );

  const folderItems: AtMentionOption[] = useMemo(
    () =>
      allFolders.map((folder: TFolder) => ({
        key: `folder-${folder.path}`,
        title: folder.name,
        subtitle: folder.path,
        category: "folders",
        data: folder,
        content: undefined,
        icon: React.createElement(Folder, { className: "tw-size-4" }),
        searchKeyword: folder.path,
      })),
    [allFolders]
  );

  const webTabItems: AtMentionOption[] = useMemo(
    () =>
      isDesktopRuntime()
        ? openWebTabs.map((tab, index) => {
            const isLoaded = tab.isLoaded !== false;
            return {
              key: `webtab-${tab.url || tab.title || index}-${index}`,
              title: tab.title || "Untitled",
              subtitle: isLoaded ? tab.url : "Tab not loaded",
              category: "webTabs",
              data: tab,
              content: undefined,
              disabled: !isLoaded,
              disabledReason: "Switch to this tab to load it first",
              icon: isLoaded
                ? React.createElement(Globe, { className: "tw-size-4" })
                : React.createElement(CircleDashed, { className: "tw-size-4 tw-text-muted" }),
              searchKeyword: `${tab.title || ""} ${tab.url || ""}`,
            };
          })
        : [],
    [openWebTabs]
  );

  const agentItems: AtMentionOption[] = useMemo(() => {
    if (!agentMentions.enabled) return [];
    if (agentMentions.entries.length === 0) {
      return [
        {
          key: CREATE_AGENT_OPTION_KEY,
          title: "Create an agent",
          subtitle: "Set one up in Settings",
          category: "agents",
          data: "",
          content: undefined,
          isAction: true,
          icon: React.createElement(Plus, { className: "tw-size-4" }),
          searchKeyword: "create an agent new",
        },
      ];
    }
    return agentMentions.entries.map((agent) => ({
      key: `agent-${agent.slug}`,
      title: agent.name,
      subtitle: agent.description || undefined,
      category: "agents",
      data: agent.slug,
      content: undefined,
      icon: React.createElement(AgentGlyph, { icon: agent.icon }),
      pillIcon: agent.icon,
      searchKeyword: `${agent.name} ${agent.slug}`,
    }));
  }, [agentMentions]);

  return useMemo(() => {
    if (mode === "category") {
      if (!query) {
        const categoryOptions = availableCategoryOptions.map((cat) => ({
          ...cat,
          content: undefined,
        })) as (CategoryOption | AtMentionOption)[];

        const activeOptions: AtMentionOption[] = [];

        if (activeWebTab) {
          activeOptions.push({
            key: "active-web-tab",
            title: "Active Web Tab",
            subtitle: undefined,
            category: "activeWebTab",
            data: activeWebTab,
            content: undefined,
            icon: React.createElement(Globe, { className: "tw-size-4" }),
          });
        }

        if (currentActiveFile) {
          activeOptions.push({
            key: `active-note-${currentActiveFile.path}`,
            title: "Active Note",
            subtitle: undefined,
            category: "activeNote",
            data: currentActiveFile,
            content: undefined,
            icon: React.createElement(FileClock, { className: "tw-size-4" }),
          });
        }

        return activeOptions.length > 0 ? [...activeOptions, ...categoryOptions] : categoryOptions;
      }

      const queryLower = query.toLowerCase();
      const matchingTools = toolItems.filter((tool) => {
        return tool.title.toLowerCase().includes(queryLower);
      });

      const matchingAgents = agentItems.filter(
        (agent) =>
          agent.title.toLowerCase().includes(queryLower) ||
          (typeof agent.data === "string" && agent.data.toLowerCase().includes(queryLower))
      );

      const activeNoteTitle = "active note";
      const activeNoteMatches = activeNoteTitle.includes(queryLower);
      const activeNoteOption =
        activeNoteMatches && currentActiveFile
          ? {
              key: `active-note-${currentActiveFile.path}`,
              title: "Active Note",
              subtitle: undefined,
              category: "activeNote" as AtMentionCategory,
              data: currentActiveFile,
              content: undefined,
              icon: React.createElement(FileClock, { className: "tw-size-4" }),
            }
          : null;

      const activeWebTabTitle = "active web tab";
      const activeWebTabMatches = activeWebTabTitle.includes(queryLower);
      const activeWebTabOption =
        activeWebTabMatches && activeWebTab
          ? {
              key: "active-web-tab",
              title: "Active Web Tab",
              subtitle: undefined,
              category: "activeWebTab" as AtMentionCategory,
              data: activeWebTab,
              content: undefined,
              icon: React.createElement(Globe, { className: "tw-size-4" }),
            }
          : null;

      const allNonToolItems = [...noteItems, ...folderItems, ...webTabItems];
      const fuzzySearchResults = fuzzysort.go(query, allNonToolItems, {
        keys: ["searchKeyword"],
        limit: MAX_SEARCH_RESULTS,
        threshold: -10000,
      });

      const rankedNonToolItems = fuzzySearchResults.map((result) => result.obj);

      return [
        ...matchingAgents,
        ...matchingTools,
        ...(activeWebTabOption ? [activeWebTabOption] : []),
        ...(activeNoteOption ? [activeNoteOption] : []),
        ...rankedNonToolItems,
      ].slice(0, MAX_SEARCH_RESULTS);
    } else {
      let items: AtMentionOption[] = [];

      switch (selectedCategory) {
        case "agents":
          items = agentItems;
          break;
        case "notes":
          items = noteItems;
          break;
        case "tools":
          items = toolItems;
          break;
        case "folders":
          items = folderItems;
          break;
        case "webTabs":
          items = webTabItems;
          break;
      }

      if (!query) {
        if (selectedCategory === "notes") {
          const customPromptsFolder = getEffectiveCustomPromptsFolder();
          const regularNotes = items.filter(
            (item) =>
              !(
                typeof item.data === "object" &&
                "path" in item.data &&
                typeof item.data.path === "string" &&
                item.data.path.startsWith(customPromptsFolder + "/")
              )
          );
          const customCommandNotes = items.filter(
            (item) =>
              typeof item.data === "object" &&
              "path" in item.data &&
              typeof item.data.path === "string" &&
              item.data.path.startsWith(customPromptsFolder + "/")
          );
          return [...regularNotes, ...customCommandNotes].slice(0, MAX_SEARCH_RESULTS);
        }
        return items.slice(0, MAX_SEARCH_RESULTS);
      }

      const results = fuzzysort.go(query, items, {
        keys: ["title", "subtitle"],
        limit: MAX_SEARCH_RESULTS,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    }
  }, [
    mode,
    query,
    selectedCategory,
    noteItems,
    toolItems,
    folderItems,
    webTabItems,
    agentItems,
    availableCategoryOptions,
    activeWebTab,
    currentActiveFile,
  ]);
}
