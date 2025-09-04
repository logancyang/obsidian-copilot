import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  TextNode,
  COMMAND_PRIORITY_LOW,
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
import { cn } from "@/lib/utils";
import { logInfo } from "@/logger";

// Helper function from smart-composer
function tryToPositionRange(leadOffset: number, range: Range, editorWindow: Window): boolean {
  const domSelection = editorWindow.getSelection();
  if (domSelection === null || !domSelection.isCollapsed) {
    return false;
  }
  const anchorNode = domSelection.anchorNode;
  const startOffset = leadOffset;
  const endOffset = domSelection.anchorOffset;

  if (anchorNode == null || endOffset == null) {
    return false;
  }

  try {
    range.setStart(anchorNode, startOffset);
    range.setEnd(anchorNode, endOffset);
  } catch {
    return false;
  }

  return true;
}

interface SlashCommandOption {
  key: string;
  title: string;
  content: string;
  command: CustomCommand;
}

interface SlashCommandMenuProps {
  options: SlashCommandOption[];
  selectedIndex: number;
  onSelect: (option: SlashCommandOption) => void;
  onClose: () => void;
  onHighlight: (index: number) => void;
  range: Range | null;
  query: string;
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  options,
  selectedIndex,
  onSelect,
  onClose,
  onHighlight,
  range,
  query,
}) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  // Calculate position relative to the document viewport for portal rendering
  const recalcPosition = useCallback(() => {
    if (!range) return;
    const rect = range.getBoundingClientRect();

    const menuWidth = menuRef.current?.offsetWidth || 320; // tw-min-w-80 => 320px
    const menuHeight = menuRef.current?.offsetHeight || 240; // tw-max-h-60 => 240px

    // Default: show ABOVE caret, positioned relative to viewport
    const desiredTop = rect.top - 4 - menuHeight;
    const desiredLeft = rect.left;

    // Clamp within viewport
    const minTop = 8; // small margin from top
    const maxTop = window.innerHeight - menuHeight - 8;
    const minLeft = 8; // small margin from left
    const maxLeft = window.innerWidth - menuWidth - 8;

    const top = Math.min(Math.max(desiredTop, minTop), maxTop);
    const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

    const newPosition = { top, left };
    console.log(
      "SlashMenu position (viewport-relative)",
      newPosition,
      "menu size:",
      { menuWidth, menuHeight },
      "range rect:",
      rect,
      "viewport:",
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPosition(newPosition);
  }, [range]);

  useEffect(() => {
    recalcPosition();
  }, [recalcPosition]);

  useEffect(() => {
    const handler = () => recalcPosition();
    // Listen for window resize and scroll events on the document
    window.addEventListener("resize", handler);
    document.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      document.removeEventListener("scroll", handler);
    };
  }, [recalcPosition]);

  // Recalculate when the menu size could change
  useEffect(() => {
    recalcPosition();
  }, [options.length, selectedIndex, query, recalcPosition]);

  // Position the preview panel next to the menu on the left side (viewport-relative)
  const recalcPreview = useCallback(() => {
    if (!menuRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const itemRect = selectedItemRef.current?.getBoundingClientRect();

    const fixedWidth = 360; // fixed preview width
    const minHeight = 120; // minimum preview height
    const gutter = 8; // gap between preview and menu

    // Position preview to the left of the menu (viewport coordinates)
    // Right edge of preview should align with left edge of menu minus gutter
    const desiredLeft = menuRect.left - gutter - fixedWidth;

    // Vertically align to selected item if available, otherwise to menu top
    const desiredTop = itemRect ? itemRect.top : menuRect.top;

    // Clamp within viewport
    const minLeft = 8; // small margin from left edge
    const maxLeft = window.innerWidth - fixedWidth - 8;
    const minTop = 8; // small margin from top edge
    const maxTop = window.innerHeight - minHeight - 8;

    const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
    const top = Math.min(Math.max(desiredTop, minTop), maxTop);

    setPreviewPosition({ top, left });
  }, []);

  useEffect(() => {
    recalcPreview();
  }, [selectedIndex, options.length, position, recalcPreview]);
  useEffect(() => {
    const handler = () => recalcPreview();
    // Listen for window resize and scroll events
    window.addEventListener("resize", handler);
    document.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      document.removeEventListener("scroll", handler);
    };
  }, [recalcPreview]);

  // Scroll the selected item into view when selection changes
  useEffect(() => {
    if (selectedItemRef.current && menuRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  if (!position || options.length === 0) {
    return null;
  }

  const menu = (
    <div
      className={cn(
        "tw-absolute tw-max-h-60 tw-min-w-80 tw-overflow-y-auto tw-rounded-lg tw-border tw-border-border tw-bg-primary tw-shadow-lg"
      )}
      style={{
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      ref={menuRef}
    >
      <div className="tw-p-2 tw-text-normal">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <div
              key={option.key}
              ref={isSelected ? selectedItemRef : undefined}
              className={cn(
                "tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-px-3 tw-py-2 tw-text-sm tw-text-normal",
                isSelected ? "tw-bg-secondary" : "hover:tw-bg-secondary"
              )}
              onClick={() => onSelect(option)}
              onMouseEnter={() => onHighlight(index)}
            >
              <div className="tw-font-medium tw-text-normal">{option.title}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
  const preview =
    previewPosition && options[selectedIndex] ? (
      <div
        className={cn(
          "tw-absolute tw-overflow-y-auto tw-rounded-md tw-border tw-border-border tw-bg-primary tw-shadow-lg"
        )}
        style={{
          top: previewPosition.top ?? 0,
          left: previewPosition.left ?? 0,
          width: 360,
          minHeight: 120,
          maxHeight: 400,
          padding: 12,
          fontSize: "0.875rem",
          zIndex: 10000,
        }}
      >
        <div className="tw-mb-1 tw-text-xs tw-text-muted">Preview</div>
        <div className="tw-whitespace-pre-wrap tw-text-normal">
          {options[selectedIndex].content}
        </div>
      </div>
    ) : null;

  return (
    <>
      {createPortal(menu, document.body)}
      {preview && createPortal(preview, document.body)}
    </>
  );
};

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
    logInfo("SlashMenu All cached commands:", commands.length);
    const slashCommands = sortSlashCommands(commands.filter((cmd) => cmd.showInSlashMenu));
    logInfo(
      "SlashMenu available commands:",
      slashCommands.length,
      slashCommands.map((c) => c.title)
    );

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

            const newText = beforeSlash + option.content + afterQuery;
            anchorNode.setTextContent(newText);

            // Set cursor after the inserted command
            const newOffset = beforeSlash.length + option.content.length;
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
      COMMAND_PRIORITY_LOW
    );

    const removeKeyUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_LOW
    );

    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_LOW
    );

    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_LOW
    );

    const removeEscapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_LOW
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
        logInfo(
          "SlashMenu text content:",
          JSON.stringify(textContent),
          "cursor offset:",
          cursorOffset
        );

        // Look for slash before cursor
        let slashIndex = -1;
        for (let i = cursorOffset - 1; i >= 0; i--) {
          const char = textContent[i];
          if (char === "/") {
            // Check if slash is at start or preceded by whitespace
            if (i === 0 || /\s/.test(textContent[i - 1])) {
              slashIndex = i;
              logInfo("SlashMenu found slash at index:", i);
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
          logInfo("SlashMenu opening with query:", JSON.stringify(query));

          // Use Range for accurate positioning (smart-composer approach)
          const editorWindow = editor._window ?? window;
          const range = editorWindow.document.createRange();

          // Use the helper function to properly position the range
          const isRangePositioned = tryToPositionRange(slashIndex, range, editorWindow);

          if (isRangePositioned) {
            logInfo("SlashMenu positioned range rect:", range.getBoundingClientRect());

            setSlashCommandState({
              isOpen: true,
              query,
              selectedIndex: 0,
              anchorElement: null,
              startOffset: slashIndex,
              range: range,
            });
          } else {
            logInfo("SlashMenu failed to position range");
          }
        } else if (slashCommandState.isOpen) {
          logInfo("SlashMenu closing");
          closeSlashCommand();
        }
      });
    });
  }, [editor, slashCommandState.isOpen, closeSlashCommand]);

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSlashCommandState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));
  }, [filteredCommands]);

  return (
    <>
      {slashCommandState.isOpen && (
        <SlashCommandMenu
          options={filteredCommands}
          selectedIndex={slashCommandState.selectedIndex}
          onSelect={selectSlashCommand}
          onClose={closeSlashCommand}
          onHighlight={(index) =>
            setSlashCommandState((prev) => ({ ...prev, selectedIndex: index }))
          }
          range={slashCommandState.range}
          query={slashCommandState.query}
        />
      )}
    </>
  );
}
