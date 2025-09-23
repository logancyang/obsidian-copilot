import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isFolderPillNode } from "../pills/FolderPillNode";

interface FolderPillSyncPluginProps {
  onFoldersChange?: (folders: string[]) => void;
  onFoldersRemoved?: (removedFolders: string[]) => void;
}

export function FolderPillSyncPlugin({
  onFoldersChange,
  onFoldersRemoved,
}: FolderPillSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const [previousFolders, setPreviousFolders] = React.useState<string[]>([]);

  React.useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const currentFolders: string[] = [];

        // Traverse all nodes to find folder pills
        function traverse(node: any): void {
          if ($isFolderPillNode(node)) {
            const folderPath = node.getFolderPath();

            // Check if this folder is already in the list
            if (!currentFolders.some((f) => f === folderPath)) {
              currentFolders.push(folderPath);
            }
          }

          if (node.getChildren) {
            const children = node.getChildren();
            children.forEach(traverse);
          }
        }

        traverse(root);

        // Check for changes
        const added = currentFolders.filter(
          (folder) => !previousFolders.some((pf) => pf === folder)
        );
        const removed = previousFolders.filter(
          (folder) => !currentFolders.some((cf) => cf === folder)
        );

        if (added.length > 0 || removed.length > 0) {
          // Update callbacks
          if (onFoldersChange && currentFolders.length > 0) {
            onFoldersChange(currentFolders);
          }

          if (onFoldersRemoved && removed.length > 0) {
            onFoldersRemoved(removed);
          }

          // Update previous state
          setPreviousFolders(currentFolders);
        }
      });
    });
  }, [editor, onFoldersChange, onFoldersRemoved, previousFolders]);

  return null;
}
