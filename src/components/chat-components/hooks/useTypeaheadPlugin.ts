import { useCallback, useEffect, useState } from "react";
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
  BLUR_COMMAND,
} from "lexical";
import { tryToPositionRange } from "../TypeaheadMenuPortal";
import { TypeaheadOption } from "../TypeaheadMenuContent";

export interface TypeaheadState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  range: Range | null;
}

export interface TriggerConfig {
  char: string;
  minLength?: number;
  maxLength?: number;
  allowWhitespace?: boolean;
  multiChar?: boolean; // For triggers like [[
}

export interface UseTypeaheadPluginConfig<T extends TypeaheadOption> {
  triggerConfig: TriggerConfig;
  options: T[];
  onSelect: (option: T) => void;
  onStateChange?: (state: TypeaheadState) => void;
  onHighlight?: (index: number, option: T) => void;
}

/**
 * Generic hook for typeahead functionality that can be shared across plugins
 */
export function useTypeaheadPlugin<T extends TypeaheadOption>({
  triggerConfig,
  options,
  onSelect,
  onStateChange,
  onHighlight,
}: UseTypeaheadPluginConfig<T>) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<TypeaheadState>({
    isOpen: false,
    query: "",
    selectedIndex: 0,
    range: null,
  });

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  // Close menu
  const closeMenu = useCallback(() => {
    setState({
      isOpen: false,
      query: "",
      selectedIndex: 0,
      range: null,
    });
  }, []);

  // Handle highlighting - updates selected index and calls onHighlight
  const handleHighlight = useCallback(
    (index: number) => {
      setState((prev) => ({
        ...prev,
        selectedIndex: index,
      }));

      // Call the onHighlight callback if provided
      if (onHighlight && options[index]) {
        onHighlight(index, options[index]);
      }
    },
    [onHighlight, options]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent | null): boolean => {
      if (!event || !state.isOpen) return false;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = Math.min(state.selectedIndex + 1, options.length - 1);
          handleHighlight(nextIndex);
          return true;
        }

        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = Math.max(state.selectedIndex - 1, 0);
          handleHighlight(prevIndex);
          return true;
        }

        case "Enter":
        case "Tab":
          // If there are no options, close menu and let Enter propagate (don't prevent default)
          if (options.length === 0) {
            closeMenu();
            return false; // Let the event propagate to submit the message
          }

          event.preventDefault();
          if (options[state.selectedIndex]) {
            onSelect(options[state.selectedIndex]);
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
    [state.isOpen, state.selectedIndex, options, onSelect, closeMenu, handleHighlight]
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

    const removeBlurCommand = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        if (state.isOpen) {
          closeMenu();
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      removeKeyDownCommand();
      removeKeyUpCommand();
      removeEnterCommand();
      removeTabCommand();
      removeEscapeCommand();
      removeBlurCommand();
    };
  }, [editor, handleKeyDown, state.isOpen, closeMenu]);

  // Detect trigger patterns in text
  const detectTrigger = useCallback(
    (textContent: string, cursorOffset: number): { triggerIndex: number; query: string } | null => {
      const { char, multiChar = false, allowWhitespace = false } = triggerConfig;

      if (multiChar) {
        // Handle multi-character triggers like [[
        const triggerLength = char.length;
        let triggerIndex = -1;

        for (let i = cursorOffset - 1; i >= triggerLength - 1; i--) {
          const segment = textContent.slice(i - triggerLength + 1, i + 1);
          if (segment === char) {
            // Check if trigger is at start or preceded by whitespace
            if (i - triggerLength + 1 === 0 || /\s/.test(textContent[i - triggerLength])) {
              triggerIndex = i - triggerLength + 1;
              break;
            }
          } else if (!allowWhitespace && /\s/.test(textContent[i])) {
            // Stop if we hit whitespace without finding trigger (and whitespace not allowed)
            break;
          }
        }

        if (triggerIndex !== -1) {
          const query = textContent.slice(triggerIndex + triggerLength, cursorOffset);
          // Close menu if query starts with space
          if (query.startsWith(" ")) {
            return null;
          }
          return { triggerIndex, query };
        }
      } else {
        // Handle single-character triggers like @ or /
        let triggerIndex = -1;

        for (let i = cursorOffset - 1; i >= 0; i--) {
          const currentChar = textContent[i];
          if (currentChar === char) {
            // Check if trigger is at start or preceded by whitespace
            if (i === 0 || /\s/.test(textContent[i - 1])) {
              triggerIndex = i;
              break;
            }
          } else if (!allowWhitespace && /\s/.test(currentChar)) {
            // Stop if we hit whitespace without finding trigger (and whitespace not allowed)
            break;
          }
        }

        if (triggerIndex !== -1) {
          const query = textContent.slice(triggerIndex + 1, cursorOffset);
          // Close menu if query starts with space
          if (query.startsWith(" ")) {
            return null;
          }
          return { triggerIndex, query };
        }
      }

      return null;
    },
    [triggerConfig]
  );

  // Monitor text changes to detect triggers
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

        const triggerResult = detectTrigger(textContent, cursorOffset);

        if (triggerResult) {
          const { triggerIndex, query } = triggerResult;

          // Use Range for accurate positioning
          const editorWindow = editor._window ?? window;
          const range = tryToPositionRange(triggerIndex, editorWindow);

          if (range) {
            setState((prev) => ({
              ...prev,
              isOpen: true,
              query,
              selectedIndex: 0,
              range: range,
            }));
          }
        } else if (state.isOpen) {
          closeMenu();
        }
      });
    });
  }, [editor, state.isOpen, closeMenu, detectTrigger]);

  // Reset selected index when options change
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));
  }, [options.length]);

  // Ensure selectedIndex stays within bounds
  useEffect(() => {
    setState((prev) => {
      if (prev.selectedIndex >= options.length && options.length > 0) {
        return {
          ...prev,
          selectedIndex: Math.max(0, options.length - 1),
        };
      }
      return prev;
    });
  }, [options.length]);

  return {
    state,
    setState,
    closeMenu,
    detectTrigger,
    handleHighlight,
  };
}
