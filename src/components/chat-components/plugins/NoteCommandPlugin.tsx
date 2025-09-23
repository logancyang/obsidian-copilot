import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import fuzzysort from "fuzzysort";
import { TFile, App } from "obsidian";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import {
  $replaceTriggeredTextWithPill,
  PillData,
} from "@/components/chat-components/utils/lexicalTextUtils";

// Get app instance
declare const app: App;

interface NoteOption extends TypeaheadOption {
  file: TFile;
}

export function NoteCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  // State to track preview content for notes
  const [notePreviewContent, setNotePreviewContent] = useState<Map<string, string>>(new Map());

  // Function to load note content for preview
  const loadNoteContent = useCallback(
    async (file: TFile): Promise<string> => {
      const cached = notePreviewContent.get(file.path);
      if (cached !== undefined) {
        return cached;
      }

      try {
        const content = await app.vault.cachedRead(file);

        // Strip frontmatter (YAML front matter) from the content
        const contentWithoutFrontmatter = content
          .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
          .trim();

        const truncatedContent =
          contentWithoutFrontmatter.length > 500
            ? contentWithoutFrontmatter.slice(0, 500) + "..."
            : contentWithoutFrontmatter;

        setNotePreviewContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(file.path, truncatedContent);
          return newMap;
        });

        return truncatedContent;
      } catch (error) {
        console.warn("Failed to read note content:", error);
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

  // Get all available notes from the vault
  const allNotes = useMemo(() => {
    if (!app?.vault) {
      return [];
    }

    const markdownFiles = app.vault.getMarkdownFiles() as TFile[];

    return markdownFiles.map((file, index) => ({
      key: `${file.basename}-${index}`,
      title: file.basename,
      subtitle: file.path,
      content: "", // Will be loaded async when needed
      file,
    }));
  }, []);

  // Filter notes based on query using fuzzysort and add preview content
  const filteredNotes = useMemo(() => {
    let baseResults: NoteOption[];

    if (!currentQuery) {
      baseResults = allNotes.slice(0, 10); // Show first 10 notes when no query
    } else {
      const query = currentQuery;

      // Use fuzzysort to search through note titles
      const titleResults = fuzzysort.go(query, allNotes, {
        key: "title",
        limit: 10,
        threshold: -10000, // Allow more lenient matching
      });

      // If we have good title matches, use those
      if (titleResults.length > 0) {
        baseResults = titleResults.map((result) => result.obj);
      } else {
        // Fallback to path search if no title matches
        const pathResults = fuzzysort.go(query, allNotes, {
          key: "subtitle",
          limit: 5,
          threshold: -10000,
        });
        baseResults = pathResults.map((result) => result.obj);
      }
    }

    // Add preview content from cache to the results
    return baseResults.map((note) => ({
      ...note,
      content: notePreviewContent.get(note.file.path) || "",
    }));
  }, [allNotes, currentQuery, notePreviewContent]);

  // Shared selection handler
  const handleSelect = useCallback(
    (option: NoteOption) => {
      const pillData: PillData = {
        type: "notes",
        title: option.title,
        data: option.file,
      };

      editor.update(() => {
        $replaceTriggeredTextWithPill("[[", pillData);
      });
    },
    [editor]
  );

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "[[",
      multiChar: true,
    },
    options: filteredNotes,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
    onHighlight: (index: number, option: NoteOption) => {
      // Load content for the highlighted note if not already loaded
      if (option && !notePreviewContent.has(option.file.path)) {
        loadNoteContent(option.file);
      }
    },
  });

  // Load content for the first note when filteredNotes change
  useEffect(() => {
    if (filteredNotes.length > 0 && !notePreviewContent.has(filteredNotes[0].file.path)) {
      loadNoteContent(filteredNotes[0].file);
    }
  }, [filteredNotes, notePreviewContent, loadNoteContent]);

  return (
    <>
      {state.isOpen && (
        <TypeaheadMenuPortal
          options={filteredNotes}
          selectedIndex={state.selectedIndex}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          range={state.range}
          query={state.query}
          showPreview={true}
        />
      )}
    </>
  );
}
