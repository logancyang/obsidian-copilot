import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";

/**
 * Configuration for a specific pill type
 */
export interface PillSyncConfig<T> {
  /** Function to check if a node is of this pill type */
  isPillNode: (node: any) => boolean;
  /** Function to extract data from the pill node */
  extractData: (node: any) => T;
  /** Function to create a unique key for comparison (optional, defaults to value as-is) */
  getKey?: (item: T) => string;
}

/**
 * Props for the GenericPillSyncPlugin
 */
interface GenericPillSyncPluginProps<T> {
  /** Configuration for the pill type */
  config: PillSyncConfig<T>;
  /** Callback triggered when the list of pills changes */
  onChange?: (items: T[]) => void;
  /** Callback triggered when pills are removed from the editor */
  onRemoved?: (removedItems: T[]) => void;
}

/**
 * Generic Lexical plugin that monitors pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to pills to keep external state in sync with editor content.
 *
 * This plugin is designed to be reusable for any type of pill node by
 * providing the appropriate configuration.
 */
export function GenericPillSyncPlugin<T>({
  config,
  onChange,
  onRemoved,
}: GenericPillSyncPluginProps<T>): null {
  const [editor] = useLexicalComposerContext();
  const prevItemsRef = React.useRef<T[]>([]);

  // Default configuration values
  const { isPillNode, extractData, getKey = (item: T) => String(item) } = config;

  React.useEffect(() => {
    if (!onChange && !onRemoved) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const items: T[] = [];
        const root = $getRoot();

        /**
         * Recursively traverse the editor tree to find pill nodes
         */
        function traverse(node: any): void {
          if (isPillNode(node)) {
            const data = extractData(node);
            items.push(data);
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

        // Remove duplicates using the key function
        const seen = new Set<string>();
        const deduplicatedItems = items.filter((item) => {
          const key = getKey(item);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });

        // Sort items by their key
        const processedItems = deduplicatedItems.sort((a, b) => getKey(a).localeCompare(getKey(b)));

        // Check for changes by comparing keys
        const prevItems = prevItemsRef.current;
        const currentKeys = processedItems.map(getKey);
        const prevKeys = prevItems.map(getKey);

        const hasChanges =
          currentKeys.length !== prevKeys.length ||
          currentKeys.some((key, index) => key !== prevKeys[index]);

        if (hasChanges) {
          // Detect removed items
          if (onRemoved) {
            const currentKeySet = new Set(currentKeys);
            const removedItems = prevItems.filter((item) => !currentKeySet.has(getKey(item)));

            if (removedItems.length > 0) {
              onRemoved(removedItems);
            }
          }

          // Update current items
          prevItemsRef.current = processedItems;
          if (onChange) {
            onChange(processedItems);
          }
        }
      });
    });
  }, [editor, onChange, onRemoved, isPillNode, extractData, getKey]);

  return null;
}
