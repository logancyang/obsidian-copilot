import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isFolderPillNode } from "../FolderPillNode";

interface FolderPillSyncPluginProps {
  onFoldersChange?: (folders: { name: string; path: string }[]) => void;
  onFoldersRemoved?: (removedFolders: { name: string; path: string }[]) => void;
}

export function FolderPillSyncPlugin({
  onFoldersChange,
  onFoldersRemoved,
}: FolderPillSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const [previousFolders, setPreviousFolders] = React.useState<{ name: string; path: string }[]>(
    []
  );

  React.useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const currentFolders: { name: string; path: string }[] = [];

        // Traverse all nodes to find folder pills
        function traverse(node: any): void {
          if ($isFolderPillNode(node)) {
            const folderName = node.getFolderName();
            const folderPath = node.getFolderPath();
            const folderData = { name: folderName, path: folderPath };

            // Check if this folder is already in the list
            if (!currentFolders.some((f) => f.path === folderPath)) {
              currentFolders.push(folderData);
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
          (folder) => !previousFolders.some((pf) => pf.path === folder.path)
        );
        const removed = previousFolders.filter(
          (folder) => !currentFolders.some((cf) => cf.path === folder.path)
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
