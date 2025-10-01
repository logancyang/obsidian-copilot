import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $getRoot } from "lexical";
import { $isActiveNotePillNode } from "../pills/ActiveNotePillNode";

/**
 * Props for the ActiveNotePillSyncPlugin component
 */
interface ActiveNotePillSyncPluginProps {
  /** Callback triggered when active note pill is added */
  onActiveNoteAdded?: () => void;
  /** Callback triggered when active note pill is removed */
  onActiveNoteRemoved?: () => void;
}

/**
 * Lexical plugin that monitors active note pill nodes in the editor
 * Notifies parent when the active note pill is added or removed
 * Multiple active note pills can exist in the editor, but the context menu
 * shows a single badge tracking whether any active note pills exist
 */
export function ActiveNotePillSyncPlugin({
  onActiveNoteAdded,
  onActiveNoteRemoved,
}: ActiveNotePillSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let hasActiveNotePill = false;

    // Register update listener
    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();

        // Recursively traverse the editor tree to find active note pill
        let foundActiveNotePill = false;
        function traverse(node: any): void {
          if ($isActiveNotePillNode(node)) {
            foundActiveNotePill = true;
            return;
          }

          // Only traverse children if the node has the getChildren method
          if (typeof node.getChildren === "function") {
            const children = node.getChildren();
            for (const child of children) {
              if (foundActiveNotePill) return; // Early exit if found
              traverse(child);
            }
          }
        }

        traverse(root);

        // Detect state changes
        if (foundActiveNotePill && !hasActiveNotePill) {
          // Active note pill was added
          hasActiveNotePill = true;
          onActiveNoteAdded?.();
        } else if (!foundActiveNotePill && hasActiveNotePill) {
          // Active note pill was removed
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
