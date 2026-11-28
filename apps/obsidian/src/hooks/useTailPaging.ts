import { useCallback, useLayoutEffect, useRef, useState } from "react";

const PAGE_SIZE = 10;

function pageStartAtOrBefore(index: number, isPageStart: (index: number) => boolean): number {
  let start = Math.max(0, index);
  while (start > 0 && !isPageStart(start)) start -= 1;
  return start;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  const view = node.ownerDocument.defaultView;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = view?.getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

export function useTailPaging(total: number, isPageStart: (index: number) => boolean) {
  const tailStart = pageStartAtOrBefore(total - PAGE_SIZE, isPageStart);
  const [committedFirst, setCommittedFirst] = useState(tailStart);
  if (tailStart < committedFirst) setCommittedFirst(tailStart);
  const first = Math.min(committedFirst, tailStart);
  const isPageStartRef = useRef(isPageStart);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useLayoutEffect(() => {
    isPageStartRef.current = isPageStart;
  }, [isPageStart]);

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
          // The browser can batch the marker's out-of-view and in-view reports; only the latest counts. https://github.com/logancyang/obsidian-copilot/issues/4248
          if (!entries[entries.length - 1]?.isIntersecting) return;
          setCommittedFirst(pageStartAtOrBefore(first - PAGE_SIZE, isPageStartRef.current));
        },
        { root: scrollParent(node), rootMargin: "100% 0px 0px 0px" }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [first]
  );

  return { first, sentinelRef };
}
