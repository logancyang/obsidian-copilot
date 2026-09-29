import { useCallback, useState } from "react";

export interface TrailExpansion {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

const NO_OPEN_IDS: ReadonlySet<string> = new Set();

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
