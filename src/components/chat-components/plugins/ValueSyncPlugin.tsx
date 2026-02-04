import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

/**
 * Props for the ValueSyncPlugin component
 */
interface ValueSyncPluginProps {
  /** The text value to sync with the editor content */
  value: string;
}

/**
 * Lexical plugin that synchronizes external text value with the editor content.
 * When the value prop changes, the plugin updates the editor's content to match.
 * This enables controlled component behavior for the Lexical editor.
 */
export function ValueSyncPlugin({ value }: ValueSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    editor.update(() => {
      const root = $getRoot();
      const currentText = root.getTextContent();

      if (currentText !== value) {
        root.clear();
        // Always add a paragraph node to ensure editor is in a valid state
        const paragraph = $createParagraphNode();
        if (value) {
          paragraph.append($createTextNode(value));
        }
        root.append(paragraph);
      }
    });
  }, [editor, value]);

  return null;
}
