import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ESCAPE_COMMAND } from "lexical";

/**
 * Props for the VimEscapePlugin component.
 */
export interface VimEscapePluginProps {
  enabled: boolean;
  focusMessages: () => void;
  isStreaming: boolean;
}

/**
 * Lexical plugin that maps Escape (in the input editor) to focusing the messages area.
 * Uses COMMAND_PRIORITY_LOW so other plugins (typeahead, menus, etc.) can handle Escape first.
 */
export function VimEscapePlugin({ enabled, focusMessages, isStreaming }: VimEscapePluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    // Skip command registration when Vim navigation is disabled
    if (!enabled) {
      return;
    }

    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent) => {
        // Ignore Escape during IME composition (CJK input, etc.)
        if (event.isComposing) {
          return false;
        }

        // While streaming, let other handlers (e.g., abort/stop) take precedence.
        if (isStreaming) {
          return false;
        }

        // Only preventDefault, not stopPropagation, to allow document-level Escape handlers
        // (e.g., edit mode cancel) to still receive the event if needed.
        event.preventDefault();

        // Blur the editor first, then focus messages area.
        // This prevents Lexical from reclaiming focus after we switch.
        editor.blur();
        focusMessages();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, enabled, focusMessages, isStreaming]);

  return null;
}
