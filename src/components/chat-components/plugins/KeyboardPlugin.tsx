import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { KEY_ENTER_COMMAND } from "lexical";

interface KeyboardPluginProps {
  onSubmit: () => void;
}

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
      1 // High priority
    );
  }, [editor, onSubmit]);

  return null;
}
