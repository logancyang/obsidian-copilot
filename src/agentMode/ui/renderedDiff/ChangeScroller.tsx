import { cn } from "@/lib/utils";
import * as React from "react";

type ChangeKind = "inserted" | "deleted" | "modified";

export type ChangeStep = 1 | -1;

export interface ChangeNavigation {
  scrollerRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  layout: ChangeLayout;
  current: number;
  goTo: (index: number) => void;
  step: (direction: ChangeStep) => void;
  syncToScroll: () => void;
}

export interface ChangeScrollerProps {
  navigation: ChangeNavigation;
  children: React.ReactNode;
}

interface ChangeTick {
  kind: ChangeKind;
  top: number;
  bottom: number;
  marks: HTMLElement[];
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

// A jump only flashes its change, so the highlight never outlasts the moment the reader lands on it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/709
const FLASH_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "hsla(var(--interactive-accent-hsl), 0.3)", offset: 0 },
];
const FLASH_TIMING: KeyframeAnimationOptions = { duration: 900, easing: "ease-out" };

export function useChangeNavigation(): ChangeNavigation {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<ChangeLayout>(EMPTY_LAYOUT);
  const [current, setCurrentState] = React.useState<number | null>(null);
  // Commands step outside React's event system, so a held hotkey repeats before the next render.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
  const currentRef = React.useRef<number | null>(null);
  const setCurrent = React.useCallback((index: number | null) => {
    currentRef.current = index;
    setCurrentState(index);
  }, []);
  // The scroll event a jump fires must not re-derive the position, or a change near the end of the note,
  // which cannot scroll up to the anchor, would hand the position back to an earlier change.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
  const jumpedTo = React.useRef<number | null>(null);

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

  const goTo = React.useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scroller.scrollTop = layout.ticks[index].top - scroller.clientHeight * JUMP_ANCHOR;
      jumpedTo.current = scroller.scrollTop;
      setCurrent(index);
      if (scroller.doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (const mark of layout.ticks[index].marks) mark.animate(FLASH_KEYFRAMES, FLASH_TIMING);
    },
    [layout, setCurrent]
  );

  const step = React.useCallback(
    (direction: ChangeStep) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const total = layout.ticks.length;
      const from =
        currentRef.current ?? reachedIndex(scroller, layout.ticks) ?? (direction === 1 ? -1 : 0);
      goTo((from + direction + total) % total);
    },
    [goTo, layout]
  );

  const syncToScroll = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollTop === jumpedTo.current) return;
    jumpedTo.current = null;
    setCurrent(reachedIndex(scroller, layout.ticks));
  }, [layout, setCurrent]);

  // Before the reader reaches the first change the header still names it, so the count never switches
  // between a total and a position; the first step then goes to that change rather than past it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
  return { scrollerRef, contentRef, layout, current: current ?? 0, goTo, step, syncToScroll };
}

function reachedIndex(scroller: HTMLElement, ticks: readonly ChangeTick[]): number | null {
  const anchor = scroller.scrollTop + scroller.clientHeight * JUMP_ANCHOR;
  // A change near the end of the note never scrolls up to the anchor, so scrolling to the end selects the
  // last one; a note that fits the view is at its end without scrolling and keeps counting from the top.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
  const atEnd =
    scroller.scrollTop > 0 &&
    scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  const passed = atEnd ? ticks.length : ticks.filter((tick) => tick.top <= anchor + 1).length;
  return passed === 0 ? null : passed - 1;
}

export function ChangeScroller({ navigation, children }: ChangeScrollerProps): React.ReactElement {
  const { layout } = navigation;
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
              aria-current={index === navigation.current ? "true" : undefined}
              className={cn(
                "tw-absolute tw-m-0 tw-min-h-1 tw-cursor-pointer !tw-rounded-sm tw-border-none tw-p-0 !tw-shadow-none",
                index === navigation.current
                  ? "tw-inset-x-0 tw-ring-1 tw-ring-ring"
                  : "tw-inset-x-0.5",
                KIND_COLOR[tick.kind]
              )}
              style={{
                top: percentOf(tick.top, layout.scrollHeight),
                height: percentOf(tick.bottom - tick.top, layout.scrollHeight),
              }}
              onClick={() => navigation.goTo(index)}
            />
          ))}
        </div>
      ) : null}
      {/* Obsidian gives reading view the note's font, size and line height through this container's class.
      https://github.com/Brevilabs/obsidian-copilot-private/issues/755 */}
      <div
        ref={navigation.scrollerRef}
        className="markdown-preview-view tw-flex-1"
        onScroll={navigation.syncToScroll}
      >
        <div
          ref={navigation.contentRef}
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
      previous.marks.push(mark);
      if (previous.kind !== kind) previous.kind = "modified";
    } else {
      ticks.push({ kind, top, bottom, marks: [mark] });
    }
  }
  return { ticks, scrollHeight: scroller.scrollHeight };
}

function percentOf(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}
