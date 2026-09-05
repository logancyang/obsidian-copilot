import { useCallback, useLayoutEffect, useRef, useState } from "react";

const PAGE_SIZE = 50;

/**
 * Bounds mounted list rows while callers search and sort the full collection.
 * https://github.com/logancyang/obsidian-copilot/issues/3040
 * Attach sentinelRef to the list's final marker while displayCount is below total.
 * @param total Number of matching items available to display.
 * @param resetKey Search query whose changes restart paging before paint.
 */
export function useIncrementalPaging(total: number, resetKey: string) {
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useLayoutEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [resetKey]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      // Filtering and unmounting can remove the marker before the list is exhausted.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
      if (!node) return;
      // Popouts must observe intersections in their own window.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
      const Observer = node.ownerDocument.defaultView?.IntersectionObserver ?? IntersectionObserver;
      const observer = new Observer(
        (entries) => {
          // Leaving the viewport must not mount another batch of rows.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
          if (!entries[0]?.isIntersecting) return;
          setDisplayCount((current) => Math.min(current + PAGE_SIZE, total));
        },
        { threshold: 0.1 }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [total]
  );

  return { displayCount, sentinelRef };
}
