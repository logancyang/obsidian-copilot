import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, LexicalNode } from "lexical";

export interface PillSyncConfig<T> {
  isPillNode: (node: LexicalNode) => boolean;
  extractData: (node: LexicalNode) => T;
  getKey?: (item: T) => string;
  getChangeKey?: (item: T) => string;
}

interface GenericPillSyncPluginProps<T> {
  config: PillSyncConfig<T>;
  onChange?: (items: T[]) => void;
  onRemoved?: (removedItems: T[]) => void;
}

export function GenericPillSyncPlugin<T>({
  config,
  onChange,
  onRemoved,
}: GenericPillSyncPluginProps<T>): null {
  const [editor] = useLexicalComposerContext();
  const prevItemsRef = React.useRef<T[]>([]);

  const { isPillNode, extractData, getKey = (item: T) => String(item), getChangeKey } = config;
  const getComparisonKey = React.useMemo(() => getChangeKey ?? getKey, [getChangeKey, getKey]);

  React.useEffect(() => {
    if (!onChange && !onRemoved) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const items: T[] = [];
        const root = $getRoot();

        function traverse(node: LexicalNode): void {
          if (isPillNode(node)) {
            const data = extractData(node);
            items.push(data);
          }

          const maybeContainer = node as LexicalNode & { getChildren?: () => LexicalNode[] };
          if (typeof maybeContainer.getChildren === "function") {
            const children = maybeContainer.getChildren();
            for (const child of children) {
              traverse(child);
            }
          }
        }

        traverse(root);

        const seen = new Set<string>();
        const deduplicatedItems = items.filter((item) => {
          const key = getKey(item);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });

        const processedItems = deduplicatedItems.sort((a, b) => getKey(a).localeCompare(getKey(b)));

        const prevItems = prevItemsRef.current;
        const currentIdentityKeys = processedItems.map(getKey);
        const prevIdentityKeys = prevItems.map(getKey);
        const currentChangeKeys = processedItems.map(getComparisonKey);
        const prevChangeKeys = prevItems.map(getComparisonKey);

        const hasIdentityChanges =
          currentIdentityKeys.length !== prevIdentityKeys.length ||
          currentIdentityKeys.some((key, index) => key !== prevIdentityKeys[index]);

        const hasStateChanges =
          currentChangeKeys.length !== prevChangeKeys.length ||
          currentChangeKeys.some((key, index) => key !== prevChangeKeys[index]);

        const hasChanges = hasIdentityChanges || hasStateChanges;

        if (hasChanges) {
          if (onRemoved) {
            const currentKeySet = new Set(currentIdentityKeys);
            const removedItems = prevItems.filter((item) => !currentKeySet.has(getKey(item)));

            if (removedItems.length > 0) {
              onRemoved(removedItems);
            }
          }

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
