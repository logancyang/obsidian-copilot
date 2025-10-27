import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical";
import { SEND_SHORTCUT } from "@/constants";
import { Platform } from "obsidian";

/**
 * Props for the KeyboardPlugin component
 */
interface KeyboardPluginProps {
  /** Callback triggered when configured shortcut is pressed */
  onSubmit: () => void;
  /** Send shortcut configuration */
  sendShortcut: SEND_SHORTCUT;
}

/**
 * Lexical plugin that handles keyboard shortcuts for the chat input.
 * Supports configurable send shortcuts: Enter, Shift+Enter, Cmd+Enter, Alt+Enter
 */
export function KeyboardPlugin({ onSubmit, sendShortcut }: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        // Ignore Enter key during IME composition (e.g., Chinese, Japanese, Korean input)
        if (event.isComposing) {
          return false;
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
    case SEND_SHORTCUT.CMD_ENTER:
      return Platform.isMacOS
        ? event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey
        : event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
    case SEND_SHORTCUT.ALT_ENTER:
      return event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey;
    default:
      return false;
  }
}
