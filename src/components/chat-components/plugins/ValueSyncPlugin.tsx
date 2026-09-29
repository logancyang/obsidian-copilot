import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

interface ValueSyncPluginProps {
  value: string;
}

export function ValueSyncPlugin({ value }: ValueSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    editor.update(() => {
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
    });
  }, [editor, value]);

  return null;
}
