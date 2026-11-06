import { getScrollableParent } from "@/utils/dom/scrollableParent";
import React from "react";

interface SettingsSubPageApi {
  open: (page: React.ReactNode) => void;
  close: () => void;
}

interface ReturnPoint {
  scrollTop: number;
  focus: HTMLElement | null;
}

const SettingsSubPageContext = React.createContext<SettingsSubPageApi | null>(null);

export function useSettingsSubPage(): SettingsSubPageApi {
  const api = React.useContext(SettingsSubPageContext);
  if (!api) throw new Error("useSettingsSubPage must be used inside SettingsSubPageHost");
  return api;
}

interface SettingsSubPageHostProps {
  className?: string;
  children: React.ReactNode;
}

export const SettingsSubPageHost: React.FC<SettingsSubPageHostProps> = ({
  className,
  children,
}) => {
  const [page, setPage] = React.useState<React.ReactNode>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const returnPoint = React.useRef<ReturnPoint | null>(null);

  const api = React.useMemo<SettingsSubPageApi>(
    () => ({
      open: (next) => {
        const root = rootRef.current;
        returnPoint.current = {
          scrollTop: (root && getScrollableParent(root)?.scrollTop) ?? 0,
          focus: (root?.doc.activeElement as HTMLElement | null) ?? null,
        };
        setPage(next);
      },
      close: () => setPage(null),
    }),
    []
  );

  React.useLayoutEffect(() => {
    const scroller = rootRef.current && getScrollableParent(rootRef.current);
    const back = returnPoint.current;
    if (page !== null) {
      if (scroller) scroller.scrollTop = 0;
    } else if (back) {
      returnPoint.current = null;
      if (scroller) scroller.scrollTop = back.scrollTop;
      back.focus?.focus({ preventScroll: true });
    }
  }, [page]);

  return (
    <SettingsSubPageContext.Provider value={api}>
      <div ref={rootRef} className={className}>
        {/* The settings stay mounted while a sub-page shows, so Back finds the same tabs and local state.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/865 */}
        <div hidden={page !== null}>{children}</div>
        {page}
      </div>
    </SettingsSubPageContext.Provider>
  );
};
