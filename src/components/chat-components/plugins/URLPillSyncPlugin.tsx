import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isURLPillNode } from "../pills/URLPillNode";

/**
 * Props for the URLPillSyncPlugin component
 */
interface URLPillSyncPluginProps {
  /** Callback triggered when the list of URL pills changes */
  onURLsChange?: (urls: string[]) => void;
  /** Callback triggered when URL pills are removed from the editor */
  onURLsRemoved?: (removedUrls: string[]) => void;
}

/**
 * Lexical plugin that monitors URL pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to URL pills to keep external state in sync with editor content.
 */
export function URLPillSyncPlugin({ onURLsChange, onURLsRemoved }: URLPillSyncPluginProps) {
  const [editor] = useLexicalComposerContext();
  const prevURLsRef = React.useRef<string[]>([]);

  // Track pill changes and notify parent
  React.useEffect(() => {
    if (!onURLsChange && !onURLsRemoved) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const urls: string[] = [];
        const root = $getRoot();

        function traverse(node: any) {
          if ($isURLPillNode(node)) {
            urls.push(node.getURL());
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
        const prevURLs = prevURLsRef.current;
        const currentURLs = [...new Set(urls)].sort(); // Remove duplicates and sort
        const prevURLsSorted = [...new Set(prevURLs)].sort();

        if (JSON.stringify(prevURLsSorted) !== JSON.stringify(currentURLs)) {
          // Detect removed URLs
          if (onURLsRemoved) {
            const currentURLSet = new Set(currentURLs);
            const removedURLs = prevURLs.filter((url) => !currentURLSet.has(url));

            if (removedURLs.length > 0) {
              onURLsRemoved(removedURLs);
            }
          }

          // Update current URLs
          prevURLsRef.current = currentURLs;
          if (onURLsChange) {
            onURLsChange(currentURLs);
          }
        }
      });
    });
  }, [editor, onURLsChange, onURLsRemoved]);

  return null;
}
