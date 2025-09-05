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
} from "lexical";
import fuzzysort from "fuzzysort";
import { TFile, App } from "obsidian";
import { logInfo } from "@/logger";
import { TypeaheadMenu, tryToPositionRange, TypeaheadOption } from "./TypeaheadMenu";

// Get app instance
declare const app: App;

interface NoteOption extends TypeaheadOption {
  file: TFile;
}

export function NoteCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [noteCommandState, setNoteCommandState] = useState<{
    isOpen: boolean;
    query: string;
    selectedIndex: number;
    anchorElement: HTMLElement | null;
    startOffset: number;
    range: Range | null;
  }>({
    isOpen: false,
    query: "",
    selectedIndex: 0,
    anchorElement: null,
    startOffset: 0,
    range: null,
  });

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
    logInfo("NoteMenu All files:", markdownFiles.length);

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

    if (!noteCommandState.query) {
      baseResults = allNotes.slice(0, 10); // Show first 10 notes when no query
    } else {
      const query = noteCommandState.query;

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
  }, [allNotes, noteCommandState.query, notePreviewContent]);

  // Close note command menu
  const closeNoteCommand = useCallback(() => {
    setNoteCommandState((prev) => ({
      ...prev,
      isOpen: false,
      query: "",
      selectedIndex: 0,
      anchorElement: null,
      range: null,
    }));
  }, []);

  // Select a note
  const selectNoteCommand = useCallback(
    (option: NoteOption) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        // Replace the [[ and query text with the note link
        const anchor = selection.anchor;

        // Find the [[ position
        const anchorNode = anchor.getNode();
        if (anchorNode instanceof TextNode) {
          const textContent = anchorNode.getTextContent();
          const bracketIndex = textContent.lastIndexOf("[[", anchor.offset);

          if (bracketIndex !== -1) {
            // Replace from [[ to current position
            const beforeBracket = textContent.slice(0, bracketIndex);
            const afterQuery = textContent.slice(anchor.offset);

            const noteLink = `[[${option.title}]]`;
            const newText = beforeBracket + noteLink + afterQuery;
            anchorNode.setTextContent(newText);

            // Set cursor after the inserted note link
            const newOffset = beforeBracket.length + noteLink.length;
            anchorNode.select(newOffset, newOffset);
          }
        }
      });

      closeNoteCommand();
    },
    [editor, closeNoteCommand]
  );

  // Handle highlighting and load content for preview
  const handleHighlight = useCallback(
    (index: number) => {
      setNoteCommandState((prev) => ({ ...prev, selectedIndex: index }));

      // Load content for the highlighted note if not already loaded
      const selectedNote = filteredNotes[index];
      if (selectedNote && !notePreviewContent.has(selectedNote.file.path)) {
        loadNoteContent(selectedNote.file);
      }
    },
    [filteredNotes, notePreviewContent, loadNoteContent]
  );

  // Handle keyboard navigation in menu
  const handleKeyDown = useCallback(
    (event: KeyboardEvent | null): boolean => {
      if (!event || !noteCommandState.isOpen) return false;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = Math.min(noteCommandState.selectedIndex + 1, filteredNotes.length - 1);
          handleHighlight(nextIndex);
          return true;
        }

        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = Math.max(noteCommandState.selectedIndex - 1, 0);
          handleHighlight(prevIndex);
          return true;
        }

        case "Enter":
        case "Tab":
          event.preventDefault();
          if (filteredNotes[noteCommandState.selectedIndex]) {
            selectNoteCommand(filteredNotes[noteCommandState.selectedIndex]);
          }
          return true;

        case "Escape":
          event.preventDefault();
          closeNoteCommand();
          return true;

        default:
          return false;
      }
    },
    [
      noteCommandState.isOpen,
      noteCommandState.selectedIndex,
      filteredNotes,
      selectNoteCommand,
      closeNoteCommand,
      handleHighlight,
    ]
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

  // Monitor text changes to detect [[ commands
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (noteCommandState.isOpen) {
            closeNoteCommand();
          }
          return;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) {
          if (noteCommandState.isOpen) {
            closeNoteCommand();
          }
          return;
        }

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;
        logInfo(
          "NoteMenu text content:",
          JSON.stringify(textContent),
          "cursor offset:",
          cursorOffset
        );

        // Look for [[ before cursor
        let bracketIndex = -1;
        for (let i = cursorOffset - 1; i >= 0; i--) {
          const char = textContent[i];
          const prevChar = i > 0 ? textContent[i - 1] : "";

          if (char === "[" && prevChar === "[") {
            // Check if [[ is at start or preceded by whitespace
            if (i === 1 || /\s/.test(textContent[i - 2])) {
              bracketIndex = i - 1; // Start from the first [
              logInfo("NoteMenu found [[ at index:", bracketIndex);
              break;
            }
          } else if (/\s/.test(char)) {
            // Stop if we hit whitespace without finding [[
            break;
          }
        }

        if (bracketIndex !== -1) {
          // Extract query after [[
          const query = textContent.slice(bracketIndex + 2, cursorOffset);
          logInfo("NoteMenu opening with query:", JSON.stringify(query));

          // Use Range for accurate positioning (smart-composer approach)
          const editorWindow = editor._window ?? window;
          const range = editorWindow.document.createRange();

          // Use the helper function to properly position the range
          const isRangePositioned = tryToPositionRange(bracketIndex, range, editorWindow);

          if (isRangePositioned) {
            logInfo("NoteMenu positioned range rect:", range.getBoundingClientRect());

            setNoteCommandState({
              isOpen: true,
              query,
              selectedIndex: 0,
              anchorElement: null,
              startOffset: bracketIndex,
              range: range,
            });
          } else {
            logInfo("NoteMenu failed to position range");
          }
        } else if (noteCommandState.isOpen) {
          logInfo("NoteMenu closing");
          closeNoteCommand();
        }
      });
    });
  }, [editor, noteCommandState.isOpen, closeNoteCommand]);

  // Reset selected index when filtered notes change and load content for first note
  useEffect(() => {
    setNoteCommandState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));

    // Load content for the first note if available
    if (filteredNotes.length > 0 && !notePreviewContent.has(filteredNotes[0].file.path)) {
      loadNoteContent(filteredNotes[0].file);
    }
  }, [filteredNotes, notePreviewContent, loadNoteContent]);

  return (
    <>
      {noteCommandState.isOpen && (
        <TypeaheadMenu
          options={filteredNotes}
          selectedIndex={noteCommandState.selectedIndex}
          onSelect={selectNoteCommand}
          onClose={closeNoteCommand}
          onHighlight={handleHighlight}
          range={noteCommandState.range}
          query={noteCommandState.query}
          showPreview={true}
          menuLabel="NoteMenu"
        />
      )}
    </>
  );
}
