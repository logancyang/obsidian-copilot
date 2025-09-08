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
import { useCustomCommands } from "@/commands/state";
import { CustomCommand } from "@/commands/type";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { TypeaheadMenu, tryToPositionRange, TypeaheadOption } from "./TypeaheadMenu";

interface SlashCommandOption extends TypeaheadOption {
  command: CustomCommand;
}

export function SlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [slashCommandState, setSlashCommandState] = useState<{
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

  const commands = useCustomCommands();

  // Get all available slash commands
  const allCommands = useMemo(() => {
    const slashCommands = sortSlashCommands(commands.filter((cmd) => cmd.showInSlashMenu));

    return slashCommands.map((command, index) => ({
      key: `${command.title}-${index}`,
      title: command.title,
      content: command.content,
      command,
    }));
  }, [commands]);

  // Filter commands based on query using fuzzysort
  const filteredCommands = useMemo(() => {
    if (!slashCommandState.query) {
      return allCommands.slice(0, 10); // Show first 10 commands when no query
    }

    const query = slashCommandState.query;

    // Use fuzzysort to search through command titles
    const titleResults = fuzzysort.go(query, allCommands, {
      key: "title",
      limit: 10,
      threshold: -10000, // Allow more lenient matching
    });

    // If we have good title matches, use those
    if (titleResults.length > 0) {
      return titleResults.map((result) => result.obj);
    }

    // Fallback to content search if no title matches
    const contentResults = fuzzysort.go(query, allCommands, {
      key: "content",
      limit: 5,
      threshold: -10000,
    });

    return contentResults.map((result) => result.obj);
  }, [allCommands, slashCommandState.query]);

  // Close slash command menu
  const closeSlashCommand = useCallback(() => {
    setSlashCommandState((prev) => ({
      ...prev,
      isOpen: false,
      query: "",
      selectedIndex: 0,
      anchorElement: null,
      range: null,
    }));
  }, []);

  // Select a slash command
  const selectSlashCommand = useCallback(
    (option: SlashCommandOption) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        // Replace the slash and query text with the command content
        const anchor = selection.anchor;

        // Find the slash position
        const anchorNode = anchor.getNode();
        if (anchorNode instanceof TextNode) {
          const textContent = anchorNode.getTextContent();
          const slashIndex = textContent.lastIndexOf("/", anchor.offset);

          if (slashIndex !== -1) {
            // Replace from slash to current position
            const beforeSlash = textContent.slice(0, slashIndex);
            const afterQuery = textContent.slice(anchor.offset);

            const insertedText = option.content || option.title;
            const newText = beforeSlash + insertedText + afterQuery;
            anchorNode.setTextContent(newText);

            // Set cursor after the inserted command
            const newOffset = beforeSlash.length + insertedText.length;
            anchorNode.select(newOffset, newOffset);
          }
        }
      });

      closeSlashCommand();
    },
    [editor, closeSlashCommand]
  );

  // Handle keyboard navigation in menu
  const handleKeyDown = useCallback(
    (event: KeyboardEvent | null): boolean => {
      if (!event || !slashCommandState.isOpen) return false;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSlashCommandState((prev) => ({
            ...prev,
            selectedIndex: Math.min(prev.selectedIndex + 1, filteredCommands.length - 1),
          }));
          return true;

        case "ArrowUp":
          event.preventDefault();
          setSlashCommandState((prev) => ({
            ...prev,
            selectedIndex: Math.max(prev.selectedIndex - 1, 0),
          }));
          return true;

        case "Enter":
        case "Tab":
          event.preventDefault();
          if (filteredCommands[slashCommandState.selectedIndex]) {
            selectSlashCommand(filteredCommands[slashCommandState.selectedIndex]);
          }
          return true;

        case "Escape":
          event.preventDefault();
          closeSlashCommand();
          return true;

        default:
          return false;
      }
    },
    [
      slashCommandState.isOpen,
      slashCommandState.selectedIndex,
      filteredCommands,
      selectSlashCommand,
      closeSlashCommand,
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

  // Monitor text changes to detect slash commands
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (slashCommandState.isOpen) {
            closeSlashCommand();
          }
          return;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) {
          if (slashCommandState.isOpen) {
            closeSlashCommand();
          }
          return;
        }

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        // Look for slash before cursor
        let slashIndex = -1;
        for (let i = cursorOffset - 1; i >= 0; i--) {
          const char = textContent[i];
          if (char === "/") {
            // Check if slash is at start or preceded by whitespace
            if (i === 0 || /\s/.test(textContent[i - 1])) {
              slashIndex = i;
              break;
            }
          } else if (/\s/.test(char)) {
            // Stop if we hit whitespace without finding a slash
            break;
          }
        }

        if (slashIndex !== -1) {
          // Extract query after slash
          const query = textContent.slice(slashIndex + 1, cursorOffset);

          // Use Range for accurate positioning (smart-composer approach)
          const editorWindow = editor._window ?? window;
          const range = editorWindow.document.createRange();

          // Use the helper function to properly position the range
          const isRangePositioned = tryToPositionRange(slashIndex, range, editorWindow);

          if (isRangePositioned) {
            setSlashCommandState({
              isOpen: true,
              query,
              selectedIndex: 0,
              anchorElement: null,
              startOffset: slashIndex,
              range: range,
            });
          }
        } else if (slashCommandState.isOpen) {
          closeSlashCommand();
        }
      });
    });
  }, [editor, slashCommandState.isOpen, closeSlashCommand]);

  // Reset selected index only when query changes, not when filtered commands change
  useEffect(() => {
    setSlashCommandState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));
  }, [slashCommandState.query]);

  // Ensure selectedIndex stays within bounds when filteredCommands change
  useEffect(() => {
    setSlashCommandState((prev) => {
      if (prev.selectedIndex >= filteredCommands.length && filteredCommands.length > 0) {
        return {
          ...prev,
          selectedIndex: Math.max(0, filteredCommands.length - 1),
        };
      }
      return prev;
    });
  }, [filteredCommands.length]);

  return (
    <>
      {slashCommandState.isOpen && (
        <TypeaheadMenu
          options={filteredCommands}
          selectedIndex={slashCommandState.selectedIndex}
          onSelect={selectSlashCommand}
          onClose={closeSlashCommand}
          onHighlight={(index) =>
            setSlashCommandState((prev) => ({ ...prev, selectedIndex: index }))
          }
          range={slashCommandState.range}
          query={slashCommandState.query}
          showPreview={true}
          menuLabel="SlashMenu"
        />
      )}
    </>
  );
}
