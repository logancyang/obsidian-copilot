import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $getRoot, type LexicalNode } from "lexical";
import { $isActiveNotePillNode } from "@/components/chat-components/pills/ActiveNotePillNode";

interface ActiveNotePillSyncPluginProps {
  onActiveNoteAdded?: () => void;
  onActiveNoteRemoved?: () => void;
}

export function ActiveNotePillSyncPlugin({
  onActiveNoteAdded,
  onActiveNoteRemoved,
}: ActiveNotePillSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let hasActiveNotePill = false;

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();

        let foundActiveNotePill = false;
        function traverse(node: LexicalNode): void {
          if ($isActiveNotePillNode(node)) {
            foundActiveNotePill = true;
            return;
          }

          if ("getChildren" in node && typeof node.getChildren === "function") {
            const children = node.getChildren() as LexicalNode[];
            for (const child of children) {
              if (foundActiveNotePill) return;
              traverse(child);
            }
          }
        }

        traverse(root);

        if (foundActiveNotePill && !hasActiveNotePill) {
          hasActiveNotePill = true;
          onActiveNoteAdded?.();
        } else if (!foundActiveNotePill && hasActiveNotePill) {
          hasActiveNotePill = false;
          onActiveNoteRemoved?.();
        }
      });
    });

    return () => {
      removeUpdateListener();
    };
  }, [editor, onActiveNoteAdded, onActiveNoteRemoved]);

  return null;
}
