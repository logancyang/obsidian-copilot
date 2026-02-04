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
  /** Function to create a unique identity key for deduplication and removal detection */
  getKey?: (item: T) => string;
  /**
   * Function to create a stable key representing the full pill state for change detection.
   * Use this when pill metadata (e.g., title, favicon) can change without identity changing.
   * Defaults to `getKey(item)` if not provided.
   */
  getChangeKey?: (item: T) => string;
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
  const { isPillNode, extractData, getKey = (item: T) => String(item), getChangeKey } = config;
  // Use getChangeKey for state comparison, fallback to getKey if not provided
  const getComparisonKey = React.useMemo(() => getChangeKey ?? getKey, [getChangeKey, getKey]);

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

        // Check for changes using both identity keys (for add/remove) and change keys (for metadata updates)
        const prevItems = prevItemsRef.current;
        const currentIdentityKeys = processedItems.map(getKey);
        const prevIdentityKeys = prevItems.map(getKey);
        const currentChangeKeys = processedItems.map(getComparisonKey);
        const prevChangeKeys = prevItems.map(getComparisonKey);

        // Identity changes: items added or removed
        const hasIdentityChanges =
          currentIdentityKeys.length !== prevIdentityKeys.length ||
          currentIdentityKeys.some((key, index) => key !== prevIdentityKeys[index]);

        // State changes: metadata updated (e.g., title/favicon changed while URL stayed same)
        const hasStateChanges =
          currentChangeKeys.length !== prevChangeKeys.length ||
          currentChangeKeys.some((key, index) => key !== prevChangeKeys[index]);

        const hasChanges = hasIdentityChanges || hasStateChanges;

        if (hasChanges) {
          // Detect removed items (identity-based)
          if (onRemoved) {
            const currentKeySet = new Set(currentIdentityKeys);
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
  }, [editor, onChange, onRemoved, isPillNode, extractData, getKey, getComparisonKey]);

  return null;
}
