import { useCallback, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_PAGE_SIZE = 50;

export function useIncrementalPaging(
  total: number,
  resetKey: string,
  pageSize = DEFAULT_PAGE_SIZE
) {
  const [displayCount, setDisplayCount] = useState(pageSize);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useLayoutEffect(() => {
    setDisplayCount(pageSize);
  }, [resetKey, pageSize]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      // Popouts must observe intersections in their own window.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/372
      const Observer = node.ownerDocument.defaultView?.IntersectionObserver ?? IntersectionObserver;
      const observer = new Observer(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          setDisplayCount((current) => Math.min(current + pageSize, total));
        },
        { threshold: 0.1 }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [total, pageSize]
  );

  return { displayCount, sentinelRef };
}
