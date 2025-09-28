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
        })) as (CategoryOption | AtMentionOption)[];
      }

      // Search across all categories when query exists
      // Convert name matches to AtMentionOption format (prioritized)
      const nameMatchItems: AtMentionOption[] = noteSearchResults.nameMatches.map((result) => ({
        ...result,
        category: "notes" as AtMentionCategory,
        data: result.file,
        icon: React.createElement(FileText, { className: "tw-size-4" }),
      }));

      // Convert path-only matches to AtMentionOption format (lower priority)
      const pathOnlyItems: AtMentionOption[] = noteSearchResults.pathOnlyMatches.map((result) => ({
        ...result,
        category: "notes" as AtMentionCategory,
        data: result.file,
        icon: React.createElement(FileText, { className: "tw-size-4" }),
      }));

      // Create items for other categories
      const toolItems: AtMentionOption[] = isCopilotPlus
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

      const folderItems: AtMentionOption[] = allFolders.map((folder: TFolder) => ({
        key: `folder-${folder.path}`,
        title: folder.name,
        subtitle: folder.path,
        category: "folders" as AtMentionCategory,
        data: folder,
        content: undefined,
        icon: React.createElement(Folder, { className: "tw-size-4" }),
      }));

      const tagItems: AtMentionOption[] = allTags.map((tag) => ({
        key: `tag-${tag}`,
        title: tag.startsWith("#") ? tag.slice(1) : tag,
        subtitle: undefined,
        category: "tags" as AtMentionCategory,
        data: tag,
        content: undefined,
        icon: React.createElement(Hash, { className: "tw-size-4" }),
      }));

      // Search tools using exact string matching on name only (case-insensitive)
      const queryLower = query.toLowerCase();
      const matchingTools = toolItems.filter((tool) => {
        return tool.title.toLowerCase().includes(queryLower);
      });

      // Search folders and tags together (lower priority)
      const folderTagItems = [...folderItems, ...tagItems];
      const folderTagSearchResults = fuzzysort.go(query, folderTagItems, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      const matchingFoldersAndTags = folderTagSearchResults.map((result) => result.obj);

      // Prioritize: tools first, then note name matches, then folders/tags, then path-only matches
      const prioritizedResults = [
        ...matchingTools, // Tools with matching names (highest priority)
        ...nameMatchItems, // Note name matches (second priority)
        ...matchingFoldersAndTags, // Folders and tags (third priority)
        ...pathOnlyItems, // Notes that only match by path (lowest priority)
      ];

      return prioritizedResults.slice(0, 10);
    } else {
      // Category-specific search mode
      let items: AtMentionOption[] = [];

      switch (selectedCategory) {
        case "notes":
          // Use unified note search for consistency - combine both name and path matches
          items = [
            ...noteSearchResults.nameMatches.map((result) => ({
              ...result,
              category: "notes" as AtMentionCategory,
              data: result.file,
              icon: React.createElement(FileText, { className: "tw-size-4" }),
            })),
            ...noteSearchResults.pathOnlyMatches.map((result) => ({
              ...result,
              category: "notes" as AtMentionCategory,
              data: result.file,
              icon: React.createElement(FileText, { className: "tw-size-4" }),
            })),
          ];
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
