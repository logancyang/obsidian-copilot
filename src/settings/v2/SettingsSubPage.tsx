import { useTab } from "@/contexts/TabContext";
import { cn } from "@/lib/utils";
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
  const { selectedTab } = useTab();
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

  // A page belongs to the tab it was opened from, so selecting another tab shows that tab instead.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/874
  React.useLayoutEffect(() => {
    returnPoint.current = null;
    setPage(null);
  }, [selectedTab]);

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
      <div ref={rootRef} className={cn(className, page !== null && "tw-h-full")}>
        {/* The settings stay mounted while a sub-page shows, so Back finds the same tabs and local
            state, and work in progress there (such as a connector login) is not cancelled.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/874 */}
        <div hidden={page !== null}>{children}</div>
        {page}
      </div>
    </SettingsSubPageContext.Provider>
  );
};
