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
  /** Optional callback fired when ESC is pressed; when set, swallows the event. */
  onEscape?: () => void;
  /** Optional callback fired when Shift+Tab is pressed; when set, swallows the event. */
  onShiftTab?: () => void;
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
        // event.isComposing is set by the browser while a composition session is active.
        // key "Process" is the standard indicator used during IME input.
        if (event.isComposing || event.key === "Process") {
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
    if (!onEscape) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        // Some IMEs use ESC to dismiss the candidate window — don't cancel mid-composition.
        if (event.isComposing || event.keyCode === 229) {
          return false;
        }
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
