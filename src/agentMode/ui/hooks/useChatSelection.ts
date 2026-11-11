import { useCallback, useMemo, useState } from "react";

export interface SelectionClick {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface ChatSelection<T extends { id: string }> {
  selectedItems: readonly T[];
  isSelected: (id: string) => boolean;
  handleClick: (id: string, click: SelectionClick) => boolean;
  handleContextMenu: (id: string) => void;
  handleKeyDown: (event: Pick<KeyboardEvent, "key" | "stopPropagation">) => void;
  clear: () => void;
}

const NO_IDS: ReadonlySet<string> = new Set();
const NO_ITEMS: readonly never[] = Object.freeze([]);

export function useChatSelection<T extends { id: string }>(
  visibleItems: readonly T[]
): ChatSelection<T> {
  const [storedIds, setStoredIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const selectedItems = useMemo(() => {
    const items = visibleItems.filter((item) => storedIds.has(item.id));
    return items.length === 0 ? NO_ITEMS : items;
  }, [visibleItems, storedIds]);
  const selectedIds = useMemo(
    () => (selectedItems.length === 0 ? NO_IDS : new Set(selectedItems.map((item) => item.id))),
    [selectedItems]
  );

  const clear = useCallback(() => {
    setStoredIds(NO_IDS);
    setAnchorId(null);
  }, []);

  const handleClick = useCallback(
    (id: string, click: SelectionClick): boolean => {
      const ids = visibleItems.map((item) => item.id);
      const anchorIndex = anchorId === null ? -1 : ids.indexOf(anchorId);
      if (click.shiftKey && anchorIndex !== -1) {
        const index = ids.indexOf(id);
        setStoredIds(
          new Set(ids.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1))
        );
        return true;
      }
      if (click.shiftKey || click.metaKey || click.ctrlKey) {
        const next = new Set(selectedIds);
        if (next.has(id) && !click.shiftKey) next.delete(id);
        else next.add(id);
        setStoredIds(next);
        setAnchorId(id);
        return true;
      }
      clear();
      return false;
    },
    [anchorId, clear, selectedIds, visibleItems]
  );

  const handleContextMenu = useCallback(
    (id: string) => {
      if (!selectedIds.has(id)) clear();
    },
    [clear, selectedIds]
  );

  const handleKeyDown = useCallback(
    (event: Pick<KeyboardEvent, "key" | "stopPropagation">) => {
      if (event.key !== "Escape" || selectedIds.size === 0) return;
      event.stopPropagation();
      clear();
    },
    [clear, selectedIds]
  );

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return useMemo(
    () => ({ selectedItems, isSelected, handleClick, handleContextMenu, handleKeyDown, clear }),
    [selectedItems, isSelected, handleClick, handleContextMenu, handleKeyDown, clear]
  );
}
