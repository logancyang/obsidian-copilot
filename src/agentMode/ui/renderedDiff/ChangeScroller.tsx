import { cn } from "@/lib/utils";
import * as React from "react";

type ChangeKind = "inserted" | "deleted" | "modified";

export interface ChangeScrollerProps {
  children: React.ReactNode;
}

interface ChangeTick {
  kind: ChangeKind;
  top: number;
  bottom: number;
}

interface ChangeLayout {
  ticks: readonly ChangeTick[];
  scrollHeight: number;
}

const EMPTY_TICKS: readonly ChangeTick[] = Object.freeze([]);
const EMPTY_LAYOUT: ChangeLayout = Object.freeze({ ticks: EMPTY_TICKS, scrollHeight: 0 });

const CHANGE_MARK = "[data-change=inserted], [data-change=deleted]";

const KIND_COLOR: Record<ChangeKind, string> = {
  inserted: cn("!tw-bg-change-inserted"),
  deleted: cn("!tw-bg-change-deleted"),
  modified: cn("!tw-bg-change-modified"),
};

// A jump leaves the change in the upper third so the text leading into it stays readable.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/709
const JUMP_ANCHOR = 0.3;

export function ChangeScroller({ children }: ChangeScrollerProps): React.ReactElement {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<ChangeLayout>(EMPTY_LAYOUT);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const measure = (): void => setLayout(measureChanges(scroller, content));
    measure();
    // Sections render and mark their changes asynchronously, images and embeds load after the first
    // layout and push changes down the note, and resizing the pane changes the scroll height that
    // tick positions are a share of.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
    const view = content.doc.defaultView;
    const mutations = view ? new view.MutationObserver(measure) : null;
    mutations?.observe(content, { childList: true, subtree: true });
    const resizes = view?.ResizeObserver ? new view.ResizeObserver(measure) : null;
    resizes?.observe(content);
    resizes?.observe(scroller);
    return () => {
      mutations?.disconnect();
      resizes?.disconnect();
    };
  }, []);

  const jumpTo = (tick: ChangeTick): void => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = tick.top - scroller.clientHeight * JUMP_ANCHOR;
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1">
      {layout.ticks.length > 0 ? (
        <div className="tw-relative tw-w-2.5 tw-shrink-0 tw-border-0 tw-border-r tw-border-solid tw-border-border tw-bg-secondary">
          {layout.ticks.map((tick, index) => (
            <button
              // eslint-disable-next-line @eslint-react/no-array-index-key -- ticks are rebuilt whole from the marks, so position is a tick identity
              key={index}
              type="button"
              aria-label={`Go to change ${index + 1} of ${layout.ticks.length}`}
              className={cn(
                "tw-absolute tw-inset-x-0.5 tw-m-0 tw-min-h-1 tw-cursor-pointer !tw-rounded-sm tw-border-none tw-p-0 !tw-shadow-none",
                KIND_COLOR[tick.kind]
              )}
              style={{
                top: percentOf(tick.top, layout.scrollHeight),
                height: percentOf(tick.bottom - tick.top, layout.scrollHeight),
              }}
              onClick={() => jumpTo(tick)}
            />
          ))}
        </div>
      ) : null}
      <div ref={scrollerRef} className="tw-flex-1 tw-overflow-y-auto tw-p-[var(--file-margins)]">
        <div
          ref={contentRef}
          className="markdown-rendered tw-mx-auto tw-max-w-[var(--file-line-width)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Marks at most a line apart read as one change, so they share a tick.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/709
function measureChanges(scroller: HTMLElement, content: HTMLElement): ChangeLayout {
  const marks = Array.from(content.querySelectorAll<HTMLElement>(CHANGE_MARK)).filter(
    (mark) => mark.parentElement?.closest(CHANGE_MARK) === null
  );
  if (marks.length === 0) return EMPTY_LAYOUT;
  const lineHeight = parseFloat(content.win.getComputedStyle(content).lineHeight) || 0;
  const scrollOrigin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const ticks: ChangeTick[] = [];
  for (const mark of marks) {
    const rect = mark.getBoundingClientRect();
    const kind = mark.dataset.change as ChangeKind;
    const top = rect.top - scrollOrigin;
    const bottom = rect.bottom - scrollOrigin;
    const previous = ticks[ticks.length - 1];
    if (previous && top - previous.bottom <= lineHeight) {
      previous.bottom = Math.max(previous.bottom, bottom);
      if (previous.kind !== kind) previous.kind = "modified";
    } else {
      ticks.push({ kind, top, bottom });
    }
  }
  return { ticks, scrollHeight: scroller.scrollHeight };
}

function percentOf(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}
