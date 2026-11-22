import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

export const VALUE_SYNC_TAG = "copilot-value-sync";

interface ValueSyncPluginProps {
  value: string;
}

export function ValueSyncPlugin({ value }: ValueSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    editor.update(
      () => {
        const root = $getRoot();
        const currentText = root.getTextContent();

        if (currentText !== value) {
          root.clear();
          const paragraph = $createParagraphNode();
          if (value) {
            paragraph.append($createTextNode(value));
          }
          root.append(paragraph);
        }
      },
      { tag: VALUE_SYNC_TAG }
    );
  }, [editor, value]);

  return null;
}
