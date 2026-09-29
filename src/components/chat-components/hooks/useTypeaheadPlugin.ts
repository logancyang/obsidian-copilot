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
import { tryToPositionRange } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";

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
  multiChar?: boolean;
}

export interface UseTypeaheadPluginConfig<T extends TypeaheadOption> {
  triggerConfig: TriggerConfig;
  options: T[];
  onSelect: (option: T) => void;
  onStateChange?: (state: TypeaheadState) => void;
  onHighlight?: (index: number, option: T) => void;
}

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

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const closeMenu = useCallback(() => {
    setState({
      isOpen: false,
      query: "",
      selectedIndex: 0,
      range: null,
    });
  }, []);

  const handleHighlight = useCallback(
    (index: number) => {
      setState((prev) => ({
        ...prev,
        selectedIndex: index,
      }));

      if (onHighlight && options[index]) {
        onHighlight(index, options[index]);
      }
    },
    [onHighlight, options]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent | null): boolean => {
      if (!event || !state.isOpen) return false;

      switch (event.key) {
        case "ArrowDown": {
          if (options.length === 0) return false;
          event.preventDefault();
          let nextIndex = state.selectedIndex + 1;
          while (nextIndex < options.length && options[nextIndex]?.disabled) {
            nextIndex++;
          }
          if (nextIndex >= options.length) {
            nextIndex = state.selectedIndex;
          }
          handleHighlight(nextIndex);
          return true;
        }

        case "ArrowUp": {
          if (options.length === 0) return false;
          event.preventDefault();
          let prevIndex = state.selectedIndex - 1;
          while (prevIndex >= 0 && options[prevIndex]?.disabled) {
            prevIndex--;
          }
          if (prevIndex < 0) {
            prevIndex = state.selectedIndex;
          }
          handleHighlight(prevIndex);
          return true;
        }

        case "Enter":
        case "Tab":
          if (options.length === 0) {
            closeMenu();
            return false;
          }

          if (options[state.selectedIndex]?.disabled) {
            return true;
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

  const detectTrigger = useCallback(
    (textContent: string, cursorOffset: number): { triggerIndex: number; query: string } | null => {
      const { char, multiChar = false, allowWhitespace = false } = triggerConfig;

      if (multiChar) {
        const triggerLength = char.length;
        let triggerIndex = -1;

        for (let i = cursorOffset - 1; i >= triggerLength - 1; i--) {
          const segment = textContent.slice(i - triggerLength + 1, i + 1);
          if (segment === char) {
            if (i - triggerLength + 1 === 0 || /\s/.test(textContent[i - triggerLength])) {
              triggerIndex = i - triggerLength + 1;
              break;
            }
          } else if (!allowWhitespace && /\s/.test(textContent[i])) {
            break;
          }
        }

        if (triggerIndex !== -1) {
          const query = textContent.slice(triggerIndex + triggerLength, cursorOffset);
          if (query.startsWith(" ")) {
            return null;
          }
          return { triggerIndex, query };
        }
      } else {
        let triggerIndex = -1;

        for (let i = cursorOffset - 1; i >= 0; i--) {
          const currentChar = textContent[i];
          if (currentChar === char) {
            if (i === 0 || /\s/.test(textContent[i - 1])) {
              triggerIndex = i;
              break;
            }
          } else if (!allowWhitespace && /\s/.test(currentChar)) {
            break;
          }
        }

        if (triggerIndex !== -1) {
          const query = textContent.slice(triggerIndex + 1, cursorOffset);
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

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      selectedIndex: 0,
    }));
  }, [options.length]);

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
