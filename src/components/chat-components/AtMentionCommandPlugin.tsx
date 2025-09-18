import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  TextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  $createTextNode,
} from "lexical";
import fuzzysort from "fuzzysort";
import { TFile, TFolder, App } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import { tryToPositionRange, TypeaheadOption } from "./TypeaheadMenu";
import { AtMentionTypeaheadMenu } from "./AtMentionTypeaheadMenu";
import { $createNotePillNode } from "./NotePillPlugin";
import { $createToolPillNode } from "./ToolPillNode";
import { $createFolderPillNode } from "./FolderPillNode";
import { $createTagPillNode } from "./TagPillNode";
import { getToolDescription } from "@/tools/toolManager";

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

interface AtMentionState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  range: Range | null;
  mode: "category" | "search";
  selectedCategory?: AtMentionCategory;
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

const AVAILABLE_TOOLS = ["@vault", "@websearch", "@youtube", "@pomodoro", "@composer"];

export function AtMentionCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<AtMentionState>({
    isOpen: false,
    query: "",
    selectedIndex: 0,
    range: null,
    mode: "category",
  });

  // Cache for loaded content
  const [notePreviewContent, setNotePreviewContent] = useState<Map<string, string>>(new Map());

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

    // Get tags from all files
    app.vault.getMarkdownFiles().forEach((file) => {
      const metadata = app.metadataCache.getFileCache(file);
      if (metadata?.tags) {
        metadata.tags.forEach((tag) => {
          tags.add(tag.tag.startsWith("#") ? tag.tag : `#${tag.tag}`);
        });
      }
    });

    return Array.from(tags);
  }, []);

  // Load note content for preview
  const loadNoteContent = useCallback(
    async (file: TFile): Promise<string> => {
      const cached = notePreviewContent.get(file.path);
      if (cached !== undefined) return cached;

      try {
        const content = await app.vault.cachedRead(file);
        const contentWithoutFrontmatter = content
          .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
          .trim();
        const truncatedContent =
          contentWithoutFrontmatter.length > 300
            ? contentWithoutFrontmatter.slice(0, 300) + "..."
            : contentWithoutFrontmatter;

        setNotePreviewContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(file.path, truncatedContent);
          return newMap;
        });

        return truncatedContent;
      } catch {
        const errorMsg = "Failed to load content";
        setNotePreviewContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(file.path, errorMsg);
          return newMap;
        });
        return errorMsg;
      }
    },
    [notePreviewContent]
  );

  // Get search results based on mode and category
  const searchResults = useMemo(() => {
    if (state.mode === "category") {
      // Show category options
      if (!state.query) {
        return CATEGORY_OPTIONS.map((cat) => ({
          ...cat,
          content: undefined,
        }));
      }

      // Search across all categories
      const allItems: AtMentionOption[] = [
        // Notes
        ...allNotes.map((file) => ({
          key: `note-${file.path}`,
          title: file.basename,
          subtitle: file.path,
          category: "notes" as AtMentionCategory,
          data: file,
          content: notePreviewContent.get(file.path) || "",
          icon: <FileText className="tw-size-4" />,
        })),
        // Tools
        ...AVAILABLE_TOOLS.map((tool) => ({
          key: `tool-${tool}`,
          title: tool,
          subtitle: getToolDescription(tool),
          category: "tools" as AtMentionCategory,
          data: tool,
          content: getToolDescription(tool),
          icon: <Wrench className="tw-size-4" />,
        })),
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
          title: tag,
          subtitle: "Tag",
          category: "tags" as AtMentionCategory,
          data: tag,
          content: undefined,
          icon: <Hash className="tw-size-4" />,
        })),
      ];

      // Fuzzy search across all items
      const results = fuzzysort.go(state.query, allItems, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    } else {
      // Category-specific search mode
      let items: AtMentionOption[] = [];

      switch (state.selectedCategory) {
        case "notes":
          items = allNotes.map((file) => ({
            key: `note-${file.path}`,
            title: file.basename,
            subtitle: file.path,
            category: "notes" as AtMentionCategory,
            data: file,
            content: notePreviewContent.get(file.path) || "",
            icon: <FileText className="tw-size-4" />,
          }));
          break;
        case "tools":
          items = AVAILABLE_TOOLS.map((tool) => ({
            key: `tool-${tool}`,
            title: tool,
            subtitle: getToolDescription(tool),
            category: "tools" as AtMentionCategory,
            data: tool,
            content: getToolDescription(tool),
            icon: <Wrench className="tw-size-4" />,
          }));
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
            title: tag,
            subtitle: "Tag",
            category: "tags" as AtMentionCategory,
            data: tag,
            content: undefined,
            icon: <Hash className="tw-size-4" />,
          }));
          break;
      }

      if (!state.query) {
        return items.slice(0, 10);
      }

      const results = fuzzysort.go(state.query, items, {
        keys: ["title", "subtitle"],
        limit: 10,
        threshold: -10000,
      });

      return results.map((result) => result.obj);
    }
  }, [
    state.mode,
    state.query,
    state.selectedCategory,
    allNotes,
    allFolders,
    allTags,
    notePreviewContent,
  ]);

  // Close menu
  const closeMenu = useCallback(() => {
    setState({
      isOpen: false,
      query: "",
      selectedIndex: 0,
      range: null,
      mode: "category",
      selectedCategory: undefined,
    });
  }, []);

  // Type guard functions
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

  // Select an option
  const selectOption = useCallback(
    (option: CategoryOption | AtMentionOption) => {
      if (state.mode === "category" && isCategoryOption(option) && !state.query) {
        // Category was selected - switch to search mode for that category
        setState((prev) => ({
          ...prev,
          mode: "search",
          selectedCategory: option.category,
          selectedIndex: 0,
        }));
        return;
      }

      // Item was selected - create appropriate pill
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (anchorNode instanceof TextNode && isAtMentionOption(option)) {
          const textContent = anchorNode.getTextContent();
          const atIndex = textContent.lastIndexOf("@", anchor.offset);

          if (atIndex !== -1) {
            const beforeAt = textContent.slice(0, atIndex);
            const afterQuery = textContent.slice(anchor.offset);

            // This is an AtMentionOption
            switch (option.category) {
              case "notes":
                if (option.data instanceof TFile) {
                  const activeNote = app?.workspace.getActiveFile();
                  const isActive = activeNote?.path === option.data.path;
                  const pillNode = $createNotePillNode(option.title, option.data.path, isActive);

                  if (beforeAt) {
                    anchorNode.setTextContent(beforeAt);
                    anchorNode.insertAfter(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  } else {
                    anchorNode.replace(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  }
                  pillNode.selectNext();
                }
                break;
              case "tools":
                if (typeof option.data === "string") {
                  const pillNode = $createToolPillNode(option.data);

                  if (beforeAt) {
                    anchorNode.setTextContent(beforeAt);
                    anchorNode.insertAfter(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  } else {
                    anchorNode.replace(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  }
                  pillNode.selectNext();
                }
                break;
              case "folders":
                if (option.data instanceof TFolder) {
                  const pillNode = $createFolderPillNode(option.data.name, option.data.path);

                  if (beforeAt) {
                    anchorNode.setTextContent(beforeAt);
                    anchorNode.insertAfter(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  } else {
                    anchorNode.replace(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  }
                  pillNode.selectNext();
                }
                break;
              case "tags":
                if (typeof option.data === "string") {
                  const pillNode = $createTagPillNode(option.data);

                  if (beforeAt) {
                    anchorNode.setTextContent(beforeAt);
                    anchorNode.insertAfter(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  } else {
                    anchorNode.replace(pillNode);
                    const spaceAndAfter = afterQuery ? " " + afterQuery : " ";
                    pillNode.insertAfter($createTextNode(spaceAndAfter));
                  }
                  pillNode.selectNext();
                }
                break;
            }
          }
        }
      });

      closeMenu();
    },
    [editor, state.mode, state.query, closeMenu, isAtMentionOption, isCategoryOption]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent | null): boolean => {
      if (!event || !state.isOpen) return false;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setState((prev) => ({
            ...prev,
            selectedIndex: Math.min(prev.selectedIndex + 1, searchResults.length - 1),
          }));
          return true;

        case "ArrowUp":
          event.preventDefault();
          setState((prev) => ({
            ...prev,
            selectedIndex: Math.max(prev.selectedIndex - 1, 0),
          }));
          return true;

        case "Enter":
        case "Tab":
          event.preventDefault();
          if (searchResults[state.selectedIndex]) {
            selectOption(searchResults[state.selectedIndex]);
          }
          return true;

        case "Escape":
          event.preventDefault();
          closeMenu();
          return true;

        default:
          return false;
      }
    },
    [state.isOpen, state.selectedIndex, searchResults, selectOption, closeMenu]
  );

  // Register keyboard commands
  useEffect(() => {
    const removeKeyDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH
    );

    const removeKeyUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH
    );

    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH
    );

    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH
    );

    const removeEscapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      removeKeyDownCommand();
      removeKeyUpCommand();
      removeEnterCommand();
      removeTabCommand();
      removeEscapeCommand();
    };
  }, [editor, handleKeyDown]);

  // Monitor text changes to detect @ commands
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (state.isOpen) {
            closeMenu();
          }
          return;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) {
          if (state.isOpen) {
            closeMenu();
          }
          return;
        }

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        // Look for @ before cursor
        let atIndex = -1;
        for (let i = cursorOffset - 1; i >= 0; i--) {
          const char = textContent[i];
          if (char === "@") {
            // Check if @ is at start or preceded by whitespace
            if (i === 0 || /\s/.test(textContent[i - 1])) {
              atIndex = i;
              break;
            }
          } else if (/\s/.test(char)) {
            // Stop if we hit whitespace without finding @
            break;
          }
        }

        if (atIndex !== -1) {
          // Extract query after @
          const query = textContent.slice(atIndex + 1, cursorOffset);

          // Use Range for accurate positioning
          const editorWindow = editor._window ?? window;
          const range = tryToPositionRange(atIndex, editorWindow);

          if (range) {
            setState((prev) => ({
              ...prev,
              isOpen: true,
              query,
              selectedIndex: 0,
              range: range,
              mode: query ? "category" : "category", // Start in category mode
            }));
          }
        } else if (state.isOpen) {
          closeMenu();
        }
      });
    });
  }, [editor, state.isOpen, closeMenu]);

  // Reset selected index when query changes
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));
  }, [state.query]);

  // Load content for selected note
  useEffect(() => {
    const selectedItem = searchResults[state.selectedIndex];
    if (
      selectedItem &&
      isAtMentionOption(selectedItem) &&
      selectedItem.category === "notes" &&
      selectedItem.data instanceof TFile
    ) {
      if (!notePreviewContent.has(selectedItem.data.path)) {
        loadNoteContent(selectedItem.data);
      }
    }
  }, [state.selectedIndex, searchResults, notePreviewContent, loadNoteContent, isAtMentionOption]);

  // Prepare options for TypeaheadMenu
  const menuOptions = useMemo(() => {
    return searchResults;
  }, [searchResults]);

  return (
    <>
      {state.isOpen && (
        <AtMentionTypeaheadMenu
          options={menuOptions}
          selectedIndex={state.selectedIndex}
          onSelect={selectOption}
          onClose={closeMenu}
          onHighlight={(index) => setState((prev) => ({ ...prev, selectedIndex: index }))}
          range={state.range}
          query={state.query}
          showPreview={state.mode === "search" && state.selectedCategory === "notes"}
          menuLabel="AtMention"
          mode={state.mode}
        />
      )}
    </>
  );
}
