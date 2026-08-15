import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { SEND_SHORTCUT } from "@/constants";

/**
 * Props for the KeyboardPlugin component
 */
interface KeyboardPluginProps {
  /** Callback triggered when configured shortcut is pressed */
  onSubmit: () => void;
  /** Send shortcut configuration */
  sendShortcut: SEND_SHORTCUT;
  /** Optional callback fired when ESC is pressed outside IME composition. */
  onEscape?: () => void;
  /** Optional callback fired when Shift+Tab is pressed; when set, swallows the event. */
  onShiftTab?: () => void;
}

function registerEscapeContainment(rootElement: HTMLElement): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;

    // Lexical skips key commands while composing, so contain Escape on the native
    // editor root before Obsidian can move focus into the note editor.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/302
    event.stopPropagation();
  };

  rootElement.addEventListener("keydown", handleKeyDown);
  return () => rootElement.removeEventListener("keydown", handleKeyDown);
}

/**
 * Lexical plugin that handles keyboard shortcuts for the chat input.
 * Supports configurable send shortcuts: Enter, Shift+Enter
 */
export function KeyboardPlugin({
  onSubmit,
  sendShortcut,
  onEscape,
  onShiftTab,
}: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        // Handle null event (Lexical internal use)
        if (!event) {
          return false;
        }

        // Ignore Enter key during IME composition (e.g., Chinese, Japanese, Korean input).
        if (isImeCompositionEvent(event)) {
          event.preventDefault();
          return true;
        }

        const shouldSubmit = checkShortcutMatch(event, sendShortcut);

        if (shouldSubmit) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onSubmit, sendShortcut]);

  useEffect(() => {
    let removeEscapeContainment: (() => void) | undefined;

    const unregisterRootListener = editor.registerRootListener((rootElement) => {
      removeEscapeContainment?.();
      removeEscapeContainment = rootElement ? registerEscapeContainment(rootElement) : undefined;
    });

    return () => {
      unregisterRootListener();
      removeEscapeContainment?.();
    };
  }, [editor]);

  useEffect(() => {
    if (!onEscape) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        if (isImeCompositionEvent(event)) return true;
        event.preventDefault();
        onEscape();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onEscape]);

  useEffect(() => {
    if (!onShiftTab) return;
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        event.preventDefault();
        onShiftTab();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onShiftTab]);

  return null;
}

/**
 * Prevents IME candidate confirmation or dismissal from triggering chat shortcuts.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/302
 * @param event - The keyboard event to check
 * @returns True if the event is part of an IME composition session
 */
export function isImeCompositionEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === "Process";
}

/**
 * Checks if a keyboard event matches the configured send shortcut.
 * Exported for testing purposes.
 * @param event - The keyboard event to check
 * @param shortcut - The configured send shortcut
 * @returns True if the event matches the shortcut, false otherwise
 */
export function checkShortcutMatch(event: KeyboardEvent, shortcut: SEND_SHORTCUT): boolean {
  switch (shortcut) {
    case SEND_SHORTCUT.ENTER:
      return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    case SEND_SHORTCUT.SHIFT_ENTER:
      return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    default:
      return false;
  }
}
