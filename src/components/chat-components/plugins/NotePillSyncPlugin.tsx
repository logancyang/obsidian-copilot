import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isNotePillNode } from "../pills/NotePillNode";

/**
 * Props for the NotePillSyncPlugin component
 */
interface NotePillSyncPluginProps {
  /** Callback triggered when the list of note pills changes */
  onNotesChange?: (notes: { path: string; basename: string }[]) => void;
  /** Callback triggered when note pills are removed from the editor */
  onNotesRemoved?: (removedNotes: { path: string; basename: string }[]) => void;
}

/**
 * Lexical plugin that monitors note pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to note pills to keep external state in sync with editor content.
 */
export function NotePillSyncPlugin({ onNotesChange, onNotesRemoved }: NotePillSyncPluginProps) {
  const [editor] = useLexicalComposerContext();
  const prevNotesRef = React.useRef<{ path: string; basename: string }[]>([]);

  // Track pill changes and notify parent
  React.useEffect(() => {
    if (!onNotesChange && !onNotesRemoved) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const notes: { path: string; basename: string }[] = [];
        const root = $getRoot();

        function traverse(node: any) {
          if ($isNotePillNode(node)) {
            notes.push({
              path: node.getNotePath(),
              basename: node.getNoteTitle(),
            });
          }

          // Only traverse children if the node has the getChildren method
          if (typeof node.getChildren === "function") {
            const children = node.getChildren();
            for (const child of children) {
              traverse(child);
            }
          }
        }

        traverse(root);

        // Check for changes
        const prevNotes = prevNotesRef.current;
        const currentPaths = notes.map((note) => note.path).sort();
        const prevPaths = prevNotes.map((note) => note.path).sort();

        if (JSON.stringify(prevPaths) !== JSON.stringify(currentPaths)) {
          // Detect removed notes
          if (onNotesRemoved) {
            const currentPathSet = new Set(currentPaths);
            const removedNotes = prevNotes.filter((note) => !currentPathSet.has(note.path));

            if (removedNotes.length > 0) {
              onNotesRemoved(removedNotes);
            }
          }

          // Update current notes
          prevNotesRef.current = notes;
          if (onNotesChange) {
            onNotesChange(notes);
          }
        }
      });
    });
  }, [editor, onNotesChange, onNotesRemoved]);

  return null;
}
