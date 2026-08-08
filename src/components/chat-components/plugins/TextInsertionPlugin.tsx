import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_EDITOR } from "lexical";
import { useApp } from "@/context";
import {
  INSERT_TEXT_WITH_PILLS_COMMAND,
  $insertTextWithPills,
  InsertTextOptions,
} from "@/components/chat-components/utils/lexicalTextUtils";

/**
 * Plugin that registers the INSERT_TEXT_WITH_PILLS_COMMAND to allow
 * external components to insert text with automatic pill conversion.
 */
export function TextInsertionPlugin(): null {
  const app = useApp();
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return editor.registerCommand(
      INSERT_TEXT_WITH_PILLS_COMMAND,
      (payload: { text: string; options?: InsertTextOptions }) => {
        const { text, options = {} } = payload;

        editor.update(() => {
          $insertTextWithPills(app, text, options);
        });

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, app]);

  return null;
}
