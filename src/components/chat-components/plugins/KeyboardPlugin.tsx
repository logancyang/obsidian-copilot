import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical";

/**
 * Props for the KeyboardPlugin component
 */
interface KeyboardPluginProps {
  /** Callback triggered when Enter is pressed (without Shift) */
  onSubmit: () => void;
}

/**
 * Lexical plugin that handles keyboard shortcuts for the chat input.
 * - Enter: Submits the message
 * - Shift+Enter: Creates a new line (default behavior)
 */
export function KeyboardPlugin({ onSubmit }: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.shiftKey) {
          // Allow line break on Shift+Enter
          return false;
        }

        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onSubmit]);

  return null;
}
