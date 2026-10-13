import type { ChangeKind, ChangeRun } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import { cn } from "@/lib/utils";
import * as React from "react";

export interface ChangeScrollerProps {
  runs: readonly ChangeRun[];
  children: React.ReactNode;
}

interface ChangeSpan {
  kind: ChangeKind;
  top: number;
  height: number;
}

interface ChangeLayout {
  bars: readonly ChangeSpan[];
  ticks: readonly ChangeSpan[];
  scrollHeight: number;
}

const EMPTY_SPANS: readonly ChangeSpan[] = Object.freeze([]);
const EMPTY_LAYOUT: ChangeLayout = Object.freeze({
  bars: EMPTY_SPANS,
  ticks: EMPTY_SPANS,
  scrollHeight: 0,
});

const KIND_COLOR: Record<ChangeKind, string> = {
  inserted: cn("!tw-bg-change-inserted"),
  deleted: cn("!tw-bg-change-deleted"),
  modified: cn("!tw-bg-change-modified"),
};

// A jump leaves the change in the upper third so the text leading into it stays readable.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/709
const JUMP_ANCHOR = 0.3;

export function ChangeScroller({ runs, children }: ChangeScrollerProps): React.ReactElement {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<ChangeLayout>(EMPTY_LAYOUT);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const measure = (): void => setLayout(measureChanges(runs, scroller, content));
    measure();
    // Images and embeds load after the first layout and push changes down the note.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
    const ResizeObserverConstructor = content.doc.defaultView?.ResizeObserver;
    const observer = ResizeObserverConstructor ? new ResizeObserverConstructor(measure) : null;
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [runs]);

  const jumpTo = (tick: ChangeSpan): void => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = tick.top - scroller.clientHeight * JUMP_ANCHOR;
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1">
      {layout.ticks.length > 0 ? (
        <div className="tw-relative tw-w-2.5 tw-shrink-0 tw-border-0 tw-border-r tw-border-solid tw-border-border tw-bg-secondary">
          {layout.ticks.map((tick, index) => (
            <button
              // eslint-disable-next-line @eslint-react/no-array-index-key -- ticks are rebuilt whole from the change list, so position is a tick identity
              key={index}
              type="button"
              aria-label={`Go to change ${index + 1} of ${layout.ticks.length}`}
              className={cn(
                "tw-absolute tw-inset-x-0.5 tw-m-0 tw-min-h-1 tw-cursor-pointer !tw-rounded-sm tw-border-none tw-p-0 !tw-shadow-none",
                KIND_COLOR[tick.kind]
              )}
              style={{
                top: percentOf(tick.top, layout.scrollHeight),
                height: percentOf(tick.height, layout.scrollHeight),
              }}
              onClick={() => jumpTo(tick)}
            />
          ))}
        </div>
      ) : null}
      <div ref={scrollerRef} className="tw-flex-1 tw-overflow-y-auto tw-p-[var(--file-margins)]">
        <div
          ref={contentRef}
          className="markdown-rendered tw-relative tw-mx-auto tw-max-w-[var(--file-line-width)]"
        >
          {children}
          {layout.bars.map((bar, index) => (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key -- bars are rebuilt whole from the change list, so position is a bar identity
              key={index}
              aria-hidden="true"
              data-change-bar={bar.kind}
              className={cn(
                "tw-absolute tw--left-3 tw-w-[3px] tw-rounded-full",
                KIND_COLOR[bar.kind]
              )}
              style={{ top: bar.top, height: bar.height }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function measureChanges(
  runs: readonly ChangeRun[],
  scroller: HTMLElement,
  content: HTMLElement
): ChangeLayout {
  if (runs.length === 0) return EMPTY_LAYOUT;
  const contentTop = content.getBoundingClientRect().top;
  const scrollOrigin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const bars = runs.flatMap((run) =>
    run.blocks.map((block) => {
      const rect = block.element.getBoundingClientRect();
      return { kind: block.kind, top: rect.top - contentTop, height: rect.height };
    })
  );
  const ticks = runs.map((run) => {
    const first = run.blocks[0].element.getBoundingClientRect();
    const last = run.blocks[run.blocks.length - 1].element.getBoundingClientRect();
    return { kind: run.kind, top: first.top - scrollOrigin, height: last.bottom - first.top };
  });
  return { bars, ticks, scrollHeight: scroller.scrollHeight };
}

function percentOf(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}
