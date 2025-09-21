import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import fuzzysort from "fuzzysort";
import { TFile, TFolder, App } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import { TypeaheadMenu, TypeaheadOption } from "../TypeaheadMenu";
import { getToolDescription } from "@/tools/toolManager";
import { useTypeaheadPlugin } from "../hooks/useTypeaheadPlugin";
import { $replaceTriggeredTextWithPill, PillData } from "../utils/lexicalTextUtils";
import { AVAILABLE_TOOLS } from "../constants/tools";

// Get app instance
declare const app: App;

export type AtMentionCategory = "notes" | "tools" | "folders" | "tags";

interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
}

interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder;
  icon?: React.ReactNode;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
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

    // Get tags from all files (frontmatter only)
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

  // Load note content for preview
  const loadNoteContentForPreview = useCallback(async (file: TFile) => {
    try {
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

  // Filter category options based on Copilot Plus status
  const availableCategoryOptions = useMemo(() => {
    return CATEGORY_OPTIONS.filter((cat) => {
      // Show tools category only if Copilot Plus is enabled
      if (cat.category === "tools") {
        return isCopilotPlus;
      }
      return true;
    });
  }, [isCopilotPlus]);

  // Get search results based on mode and category
  const searchResults = useMemo(() => {
    if (extendedState.mode === "category") {
      // Show category options when no query
      if (!currentQuery) {
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
          content: "", // Content loaded on demand when highlighted
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
          title: tag.startsWith("#") ? tag.slice(1) : tag, // Remove # for display
          subtitle: undefined,
          category: "tags" as AtMentionCategory,
          data: tag, // Keep original tag with # for processing
          content: undefined,
          icon: <Hash className="tw-size-4" />,
        })),
      ];

      // Fuzzy search across all items
      const results = fuzzysort.go(currentQuery, allItems, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    } else {
      // Category-specific search mode
      let items: AtMentionOption[] = [];

      switch (extendedState.selectedCategory) {
        case "notes":
          items = allNotes.map((file) => ({
            key: `note-${file.path}`,
            title: file.basename,
            subtitle: file.path,
            category: "notes" as AtMentionCategory,
            data: file,
            content: "", // Content loaded on demand when highlighted
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
            title: tag.startsWith("#") ? tag.slice(1) : tag, // Remove # for display
            subtitle: undefined,
            category: "tags" as AtMentionCategory,
            data: tag, // Keep original tag with # for processing
            content: undefined,
            icon: <Hash className="tw-size-4" />,
          }));
          break;
      }

      if (!currentQuery) {
        return items.slice(0, 10);
      }

      const results = fuzzysort.go(currentQuery, items, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    }
  }, [
    extendedState.mode,
    currentQuery,
    extendedState.selectedCategory,
    allNotes,
    allFolders,
    allTags,
    availableCategoryOptions,
    isCopilotPlus,
  ]);

  // Type guard functions (moved here to avoid circular dependencies)
  const isAtMentionOption = useCallback(
    (option: CategoryOption | AtMentionOption): option is AtMentionOption => {
      return "data" in option;
    },
    []
  );

  const isCategoryOption = useCallback(
    (option: CategoryOption | AtMentionOption): option is CategoryOption => {
      return "icon" in option;
    },
    []
  );

  // Memoized callbacks to prevent infinite re-renders
  const onSelectCallback = useCallback(
    (option: any) => {
      // Handle inline in the hook to avoid circular dependency
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

  // Use the shared typeahead hook first
  const { state, closeMenu, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "@",
    },
    options: searchResults as TypeaheadOption[],
    onSelect: onSelectCallback,
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

  // Shared selection handler for TypeaheadMenu
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

        // Close menu after selection
        closeMenu();
      }
    },
    [extendedState.mode, currentQuery, editor, closeMenu, isAtMentionOption, isCategoryOption]
  );

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
        <TypeaheadMenu
          options={displayOptions as any[]}
          selectedIndex={state.selectedIndex}
          onSelect={handleSelect}
          onClose={closeMenu}
          onHighlight={handleHighlight}
          range={state.range}
          query={state.query}
          showPreview={
            searchResults[state.selectedIndex] &&
            isAtMentionOption(searchResults[state.selectedIndex]) &&
            searchResults[state.selectedIndex].category === "notes"
          }
          menuLabel="AtMention"
          mode={extendedState.mode}
        />
      )}
    </>
  );
}
