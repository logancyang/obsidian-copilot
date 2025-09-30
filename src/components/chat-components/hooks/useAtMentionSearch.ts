import React, { useMemo } from "react";
import { TFolder } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import fuzzysort from "fuzzysort";
import { getToolDescription } from "@/tools/toolManager";
import { AVAILABLE_TOOLS } from "../constants/tools";
import { useAllNotes } from "./useAllNotes";
import { useAllFolders } from "./useAllFolders";
import { useAllTags } from "./useAllTags";
import { AtMentionCategory, AtMentionOption, CategoryOption } from "./useAtMentionCategories";

/**
 * Custom hook for @ mention search results with unified fuzzy search
 */
export function useAtMentionSearch(
  query: string,
  mode: "category" | "search",
  selectedCategory: AtMentionCategory | undefined,
  isCopilotPlus: boolean,
  availableCategoryOptions: CategoryOption[]
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
        return availableCategoryOptions.map((cat) => ({
          ...cat,
          content: undefined,
        })) as (CategoryOption | AtMentionOption)[];
      }

      // Search across all categories when query exists
      // Search tools using exact string matching on name only (case-insensitive)
      const queryLower = query.toLowerCase();
      const matchingTools = toolItems.filter((tool) => {
        return tool.title.toLowerCase().includes(queryLower);
      });

      // Combine all non-tool items for unified fuzzy search
      const allNonToolItems = [...noteItems, ...folderItems, ...tagItems];
      const fuzzySearchResults = fuzzysort.go(query, allNonToolItems, {
        keys: ["searchKeyword"],
        limit: 30,
        threshold: -10000,
      });

      const rankedNonToolItems = fuzzySearchResults.map((result) => result.obj);

      // Tools first, then everything else ranked by fuzzy search
      return [...matchingTools, ...rankedNonToolItems].slice(0, 30);
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
        return items.slice(0, 30);
      }

      const results = fuzzysort.go(query, items, {
        keys: ["title", "subtitle"],
        limit: 30,
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
  ]);
}
