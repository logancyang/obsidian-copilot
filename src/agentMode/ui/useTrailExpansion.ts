import { useCallback, useState } from "react";

/** Which expandable rows of one trail are showing their details. */
export interface TrailExpansion {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

/** Nothing is open until the user opens it — shared so a fresh mount allocates nothing. */
const NO_OPEN_IDS: ReadonlySet<string> = new Set();

/**
 * Own the open/closed state of a message's tool and activity-group rows above
 * the node list.
 *
 * `foldActivityGroups` returns a differently-shaped array as parts stream in,
 * so a group that held its own state would lose it whenever its position in
 * that array moved. Keying by the group's trail-ordinal id here instead keeps
 * an opened row visible while members stream into a group: only the user's own
 * toggle ever closes it.
 */
export function useTrailExpansion(): TrailExpansion {
  const [openIds, setOpenIds] = useState(NO_OPEN_IDS);

  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const isOpen = useCallback((id: string) => openIds.has(id), [openIds]);

  return { isOpen, toggle };
}
