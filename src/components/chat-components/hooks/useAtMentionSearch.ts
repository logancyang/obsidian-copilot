import React, { useMemo } from "react";
import { TFolder } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import fuzzysort from "fuzzysort";
import { getToolDescription } from "@/tools/toolManager";
import { AVAILABLE_TOOLS } from "../constants/tools";
import { useNoteSearch } from "./useNoteSearch";
import { useAllFolders } from "./useAllFolders";
import { useAllTags } from "./useAllTags";
import { AtMentionCategory, AtMentionOption, CategoryOption } from "./useAtMentionCategories";

/**
 * Custom hook for @ mention search results that uses unified note search
 */
export function useAtMentionSearch(
  query: string,
  mode: "category" | "search",
  selectedCategory: AtMentionCategory | undefined,
  isCopilotPlus: boolean,
  availableCategoryOptions: CategoryOption[]
): (CategoryOption | AtMentionOption)[] {
  // Use unified data hooks directly
  const noteSearchResults = useNoteSearch(query, isCopilotPlus);
  const allFolders = useAllFolders();
  const allTags = useAllTags(true);

  return useMemo(() => {
    if (mode === "category") {
      // Show category options when no query
      if (!query) {
        return availableCategoryOptions.map((cat) => ({
          ...cat,
          content: undefined,
        }));
      }

      // Search across all categories when query exists
      // Convert note search results to AtMentionOption format
      const noteItems: AtMentionOption[] = noteSearchResults.map((result) => ({
        ...result,
        category: "notes" as AtMentionCategory,
        data: result.file,
        icon: React.createElement(FileText, { className: "tw-size-4" }),
      }));

      const allItems: AtMentionOption[] = [
        ...noteItems,
        // Tools (only if Copilot Plus is enabled)
        ...(isCopilotPlus
          ? AVAILABLE_TOOLS.map((tool) => ({
              key: `tool-${tool}`,
              title: tool,
              subtitle: getToolDescription(tool),
              category: "tools" as AtMentionCategory,
              data: tool,
              content: getToolDescription(tool),
              icon: React.createElement(Wrench, { className: "tw-size-4" }),
            }))
          : []),
        // Folders
        ...allFolders.map((folder: TFolder) => ({
          key: `folder-${folder.path}`,
          title: folder.name,
          subtitle: folder.path,
          category: "folders" as AtMentionCategory,
          data: folder,
          content: undefined,
          icon: React.createElement(Folder, { className: "tw-size-4" }),
        })),
        // Tags
        ...allTags.map((tag) => ({
          key: `tag-${tag}`,
          title: tag.startsWith("#") ? tag.slice(1) : tag,
          subtitle: undefined,
          category: "tags" as AtMentionCategory,
          data: tag,
          content: undefined,
          icon: React.createElement(Hash, { className: "tw-size-4" }),
        })),
      ];

      // For non-note categories, apply fuzzy search
      const nonNoteItems = allItems.filter((item) => item.category !== "notes");
      const fuzzySearchResults = fuzzysort.go(query, nonNoteItems, {
        keys: ["title", "subtitle"],
        limit: 10 - noteItems.length, // Leave room for note results
        threshold: -10000,
      });

      // Combine note results with fuzzy search results for other categories
      return [
        ...noteItems.slice(0, 10), // Prioritize note results
        ...fuzzySearchResults.map((result) => result.obj),
      ].slice(0, 10);
    } else {
      // Category-specific search mode
      let items: AtMentionOption[] = [];

      switch (selectedCategory) {
        case "notes":
          // Use unified note search for consistency
          items = noteSearchResults.map((result) => ({
            ...result,
            category: "notes" as AtMentionCategory,
            data: result.file,
            icon: React.createElement(FileText, { className: "tw-size-4" }),
          }));
          break;
        case "tools":
          items = isCopilotPlus
            ? AVAILABLE_TOOLS.map((tool) => ({
                key: `tool-${tool}`,
                title: tool,
                subtitle: getToolDescription(tool),
                category: "tools" as AtMentionCategory,
                data: tool,
                content: getToolDescription(tool),
                icon: React.createElement(Wrench, { className: "tw-size-4" }),
              }))
            : [];
          break;
        case "folders":
          items = allFolders.map((folder: TFolder) => ({
            key: `folder-${folder.path}`,
            title: folder.name,
            subtitle: folder.path,
            category: "folders" as AtMentionCategory,
            data: folder,
            content: undefined,
            icon: React.createElement(Folder, { className: "tw-size-4" }),
          }));
          break;
        case "tags":
          items = allTags.map((tag) => ({
            key: `tag-${tag}`,
            title: tag.startsWith("#") ? tag.slice(1) : tag,
            subtitle: undefined,
            category: "tags" as AtMentionCategory,
            data: tag,
            content: undefined,
            icon: React.createElement(Hash, { className: "tw-size-4" }),
          }));
          break;
      }

      // For notes category, we already have search results from useNoteMentionSearch
      if (selectedCategory === "notes") {
        return items;
      }

      // For other categories, apply traditional search if there's a query
      if (!query) {
        return items.slice(0, 10);
      }

      const results = fuzzysort.go(query, items, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    }
  }, [
    mode,
    query,
    selectedCategory,
    noteSearchResults,
    isCopilotPlus,
    availableCategoryOptions,
    allFolders,
    allTags,
  ]);
}
