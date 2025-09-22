// cSpell:ignore fuzzysort
import React, { useMemo } from "react";
import { TFile, TFolder, App } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import fuzzysort from "fuzzysort";
import { getToolDescription } from "@/tools/toolManager";
import { AVAILABLE_TOOLS } from "../constants/tools";
import { TypeaheadOption } from "../TypeaheadMenuContent";

// Get app instance
declare const app: App;

export type AtMentionCategory = "notes" | "tools" | "folders" | "tags";

export interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder;
}

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    key: "notes",
    title: "Notes",
    subtitle: "Reference notes in your vault",
    category: "notes",
    icon: <FileText className="tw-size-4" />,
  },
  {
    key: "tools",
    title: "Tools",
    subtitle: "AI tools and commands",
    category: "tools",
    icon: <Wrench className="tw-size-4" />,
  },
  {
    key: "folders",
    title: "Folders",
    subtitle: "Reference vault folders",
    category: "folders",
    icon: <Folder className="tw-size-4" />,
  },
  {
    key: "tags",
    title: "Tags",
    subtitle: "Reference existing tags",
    category: "tags",
    icon: <Hash className="tw-size-4" />,
  },
];

export function useAtMentionData(isCopilotPlus: boolean = false) {
  // Get all available notes
  const allNotes = useMemo(() => {
    if (!app?.vault) return [];
    return app.vault.getMarkdownFiles() as TFile[];
  }, []);

  // Get all folders
  const allFolders = useMemo(() => {
    if (!app?.vault) return [];
    return app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);
  }, []);

  // Get all tags
  const allTags = useMemo(() => {
    if (!app?.metadataCache) return [];
    const tags = new Set<string>();

    app.vault.getMarkdownFiles().forEach((file) => {
      const metadata = app.metadataCache.getFileCache(file);
      const frontmatterTags = metadata?.frontmatter?.tags;

      if (frontmatterTags) {
        if (Array.isArray(frontmatterTags)) {
          frontmatterTags.forEach((tag) => {
            if (typeof tag === "string") {
              const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
              tags.add(tagWithHash);
            }
          });
        } else if (typeof frontmatterTags === "string") {
          const tagWithHash = frontmatterTags.startsWith("#")
            ? frontmatterTags
            : `#${frontmatterTags}`;
          tags.add(tagWithHash);
        }
      }
    });

    return Array.from(tags);
  }, []);

  // Filter category options based on Copilot Plus status
  const availableCategoryOptions = useMemo(() => {
    return CATEGORY_OPTIONS.filter((cat) => {
      if (cat.category === "tools") {
        return isCopilotPlus;
      }
      return true;
    });
  }, [isCopilotPlus]);

  // Get search results for a given query and mode
  const getSearchResults = useMemo(() => {
    return (query: string, mode: "category" | "search", selectedCategory?: AtMentionCategory) => {
      if (mode === "category") {
        // Show category options when no query
        if (!query) {
          return availableCategoryOptions.map((cat) => ({
            ...cat,
            content: undefined,
          }));
        }

        // Search across all categories when query exists
        const allItems: AtMentionOption[] = [
          // Notes
          ...allNotes.map((file) => ({
            key: `note-${file.path}`,
            title: file.basename,
            subtitle: file.path,
            category: "notes" as AtMentionCategory,
            data: file,
            content: "",
            icon: <FileText className="tw-size-4" />,
          })),
          // Tools (only if Copilot Plus is enabled)
          ...(isCopilotPlus
            ? AVAILABLE_TOOLS.map((tool) => ({
                key: `tool-${tool}`,
                title: tool,
                subtitle: getToolDescription(tool),
                category: "tools" as AtMentionCategory,
                data: tool,
                content: getToolDescription(tool),
                icon: <Wrench className="tw-size-4" />,
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
            icon: <Folder className="tw-size-4" />,
          })),
          // Tags
          ...allTags.map((tag) => ({
            key: `tag-${tag}`,
            title: tag.startsWith("#") ? tag.slice(1) : tag,
            subtitle: undefined,
            category: "tags" as AtMentionCategory,
            data: tag,
            content: undefined,
            icon: <Hash className="tw-size-4" />,
          })),
        ];

        // Fuzzy search across all items
        const results = fuzzysort.go(query, allItems, {
          keys: ["title", "subtitle"],
          limit: 10,
          threshold: -10000,
        });

        return results.map((result) => result.obj);
      } else {
        // Category-specific search mode
        let items: AtMentionOption[] = [];

        switch (selectedCategory) {
          case "notes":
            items = allNotes.map((file) => ({
              key: `note-${file.path}`,
              title: file.basename,
              subtitle: file.path,
              category: "notes" as AtMentionCategory,
              data: file,
              content: "",
              icon: <FileText className="tw-size-4" />,
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
                  icon: <Wrench className="tw-size-4" />,
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
              icon: <Folder className="tw-size-4" />,
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
              icon: <Hash className="tw-size-4" />,
            }));
            break;
        }

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
    };
  }, [allNotes, allFolders, allTags, availableCategoryOptions, isCopilotPlus]);

  return {
    allNotes,
    allFolders,
    allTags,
    availableCategoryOptions,
    getSearchResults,
  };
}
