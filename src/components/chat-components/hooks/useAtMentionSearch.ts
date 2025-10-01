import React, { useMemo } from "react";
import { TFolder, TFile } from "obsidian";
import { FileText, Wrench, Folder, Hash, FileClock } from "lucide-react";
import fuzzysort from "fuzzysort";
import { getToolDescription } from "@/tools/toolManager";
import { AVAILABLE_TOOLS } from "../constants/tools";
import { useAllNotes } from "./useAllNotes";
import { useAllFolders } from "./useAllFolders";
import { useAllTags } from "./useAllTags";
import { AtMentionCategory, AtMentionOption, CategoryOption } from "./useAtMentionCategories";
import { getSettings } from "@/settings/model";

// Maximum number of results to show in @ mention search
const MAX_SEARCH_RESULTS = 30;

/**
 * Custom hook for @ mention search results with unified fuzzy search
 */
export function useAtMentionSearch(
  query: string,
  mode: "category" | "search",
  selectedCategory: AtMentionCategory | undefined,
  isCopilotPlus: boolean,
  availableCategoryOptions: CategoryOption[],
  currentActiveFile: TFile | null = null
): (CategoryOption | AtMentionOption)[] {
  // Get raw data without pre-filtering
  const allNotes = useAllNotes(isCopilotPlus);
  const allFolders = useAllFolders();
  const allTags = useAllTags(true);

  // Create memoized item arrays (reused in both modes)
  const noteItems: AtMentionOption[] = useMemo(
    () =>
      allNotes.map((file, index) => ({
        key: `note-${file.basename}-${index}`,
        title: file.basename,
        subtitle: file.path,
        category: "notes" as AtMentionCategory,
        data: file,
        content: undefined,
        icon: React.createElement(FileText, { className: "tw-size-4" }),
        searchKeyword: file.path, // Search by note path
      })),
    [allNotes]
  );

  const toolItems: AtMentionOption[] = useMemo(
    () =>
      isCopilotPlus
        ? AVAILABLE_TOOLS.map((tool) => ({
            key: `tool-${tool}`,
            title: tool,
            subtitle: getToolDescription(tool),
            category: "tools" as AtMentionCategory,
            data: tool,
            content: getToolDescription(tool),
            icon: React.createElement(Wrench, { className: "tw-size-4" }),
          }))
        : [],
    [isCopilotPlus]
  );

  const folderItems: AtMentionOption[] = useMemo(
    () =>
      allFolders.map((folder: TFolder) => ({
        key: `folder-${folder.path}`,
        title: folder.name,
        subtitle: folder.path,
        category: "folders" as AtMentionCategory,
        data: folder,
        content: undefined,
        icon: React.createElement(Folder, { className: "tw-size-4" }),
        searchKeyword: folder.path, // Search by folder path
      })),
    [allFolders]
  );

  const tagItems: AtMentionOption[] = useMemo(
    () =>
      allTags.map((tag) => ({
        key: `tag-${tag}`,
        title: tag.startsWith("#") ? tag.slice(1) : tag,
        subtitle: undefined,
        category: "tags" as AtMentionCategory,
        data: tag,
        content: undefined,
        icon: React.createElement(Hash, { className: "tw-size-4" }),
        searchKeyword: tag.startsWith("#") ? tag.slice(1) : tag, // Search by tag name without #
      })),
    [allTags]
  );

  return useMemo(() => {
    if (mode === "category") {
      // Show category options when no query
      if (!query) {
        const categoryOptions = availableCategoryOptions.map((cat) => ({
          ...cat,
          content: undefined,
        })) as (CategoryOption | AtMentionOption)[];

        // Add "Active Note" option at the top if there is an active file
        if (currentActiveFile) {
          const activeNoteOption: AtMentionOption = {
            key: `active-note-${currentActiveFile.path}`,
            title: "Active Note",
            subtitle: undefined,
            category: "activeNote" as AtMentionCategory,
            data: currentActiveFile,
            content: undefined,
            icon: React.createElement(FileClock, { className: "tw-size-4" }),
          };

          return [activeNoteOption, ...categoryOptions];
        }

        return categoryOptions;
      }

      // Search across all categories when query exists
      // Search tools using exact string matching on name only (case-insensitive)
      const queryLower = query.toLowerCase();
      const matchingTools = toolItems.filter((tool) => {
        return tool.title.toLowerCase().includes(queryLower);
      });

      // Check if "active note" contains the query as a substring (case-insensitive)
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

      // Combine all non-tool items for unified fuzzy search
      const allNonToolItems = [...noteItems, ...folderItems, ...tagItems];
      const fuzzySearchResults = fuzzysort.go(query, allNonToolItems, {
        keys: ["searchKeyword"],
        limit: MAX_SEARCH_RESULTS,
        threshold: -10000,
      });

      const rankedNonToolItems = fuzzySearchResults.map((result) => result.obj);

      // Tools first, then Active Note (if matches), then everything else ranked by fuzzy search
      return [
        ...matchingTools,
        ...(activeNoteOption ? [activeNoteOption] : []),
        ...rankedNonToolItems,
      ].slice(0, MAX_SEARCH_RESULTS);
    } else {
      // Category-specific search mode - reuse memoized items
      let items: AtMentionOption[] = [];

      switch (selectedCategory) {
        case "notes":
          items = noteItems;
          break;
        case "tools":
          items = toolItems;
          break;
        case "folders":
          items = folderItems;
          break;
        case "tags":
          items = tagItems;
          break;
      }

      // Apply fuzzy search for all categories if there's a query
      if (!query) {
        // For notes category with no query, rank custom command notes lower
        if (selectedCategory === "notes") {
          const customPromptsFolder = getSettings().customPromptsFolder;
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
    tagItems,
    availableCategoryOptions,
    currentActiveFile,
  ]);
}
