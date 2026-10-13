import { applySentinels } from "@/agentMode/ui/renderedDiff/applySentinels";
import type { CodeDiffLine, DiffSegment } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { buildRenderedDiffPlan, isMarkdownPath } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import * as React from "react";

export type ChangeKind = "inserted" | "deleted" | "modified";

interface ChangedBlock {
  element: HTMLElement;
  kind: ChangeKind;
}

export interface ChangeRun {
  kind: ChangeKind;
  blocks: readonly ChangedBlock[];
}

export const EMPTY_CHANGE_RUNS: readonly ChangeRun[] = Object.freeze([]);

export interface RenderedDiffProps {
  before: string | null;
  after: string | null;
  path: string;
  onChangeRuns?: (runs: readonly ChangeRun[]) => void;
}

interface ResolvedPlan extends RenderedDiffProps {
  segments: readonly DiffSegment[];
}

export function RenderedDiff({
  before,
  after,
  path,
  onChangeRuns,
}: RenderedDiffProps): React.ReactElement | null {
  const app = useApp();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [plan, setPlan] = React.useState<ResolvedPlan | null>(null);
  React.useEffect(() => {
    let stale = false;
    void buildRenderedDiffPlan(app, before, after, isMarkdownPath(path)).then((segments) => {
      if (!stale) setPlan({ before, after, path, segments });
    });
    return () => {
      stale = true;
    };
  }, [app, before, after, path]);

  // Sections render asynchronously, so changes are collected once every rendered section has reported in.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/709
  const reportRendered = React.useMemo(() => {
    const expected = plan?.segments.filter((segment) => segment.kind !== "code").length ?? 0;
    const rendered = new Set<HTMLElement>();
    return (container?: HTMLElement): void => {
      if (container) rendered.add(container);
      if (rendered.size === expected && rootRef.current) {
        onChangeRuns?.(collectChangeRuns(rootRef.current));
      }
    };
  }, [plan, onChangeRuns]);
  React.useEffect(() => reportRendered(), [reportRendered]);
  const onMarkdownRendered = React.useCallback(
    (container: HTMLElement) => {
      decorateMarkdown(container);
      reportRendered(container);
    },
    [reportRendered]
  );
  const onBlockRendered = React.useCallback(
    (container: HTMLElement) => {
      disableTaskCheckboxes(container);
      reportRendered(container);
    },
    [reportRendered]
  );

  // A plan built for earlier props would show the previous file's changes under the new path until the new parse lands.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (plan === null || plan.before !== before || plan.after !== after || plan.path !== path) {
    return null;
  }
  return (
    // Strikethrough marks deletions here, so completed tasks drop Obsidian's done strike at every nesting depth.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    <div ref={rootRef} className="[--checklist-done-decoration:none]">
      {plan.segments.map((segment, index) => (
        <DiffSegmentView
          // eslint-disable-next-line @eslint-react/no-array-index-key -- the plan is rebuilt whole whenever the file content changes and nothing reorders it, so position is a segment identity
          key={index}
          path={path}
          segment={segment}
          onMarkdownRendered={onMarkdownRendered}
          onBlockRendered={onBlockRendered}
        />
      ))}
    </div>
  );
}

interface DiffSegmentViewProps {
  path: string;
  segment: DiffSegment;
  onMarkdownRendered: (container: HTMLElement) => void;
  onBlockRendered: (container: HTMLElement) => void;
}

function DiffSegmentView({
  path,
  segment,
  onMarkdownRendered,
  onBlockRendered,
}: DiffSegmentViewProps): React.ReactElement {
  if (segment.kind === "code") return <CodeDiffView lines={segment.lines} />;
  if (segment.kind === "block") {
    return (
      <div
        data-change={segment.change}
        className={cn(
          "tw-pl-[0.5em]",
          segment.change === "deleted"
            ? "tw-bg-error tw-text-muted tw-line-through"
            : "tw-bg-success"
        )}
      >
        <Markdown onRendered={onBlockRendered} sourcePath={path} text={segment.markdown} />
      </div>
    );
  }
  return <Markdown onRendered={onMarkdownRendered} sourcePath={path} text={segment.markdown} />;
}

const INSERTED = "[data-change=inserted]";
const DELETED = "[data-change=deleted]";

function collectChangeRuns(root: HTMLElement): readonly ChangeRun[] {
  const runs: { kind: ChangeKind; blocks: ChangedBlock[] }[] = [];
  let previousChanged = false;
  for (const segment of Array.from(root.children)) {
    for (const element of changeUnits(segment)) {
      const kind = changeKind(element);
      if (kind === null) {
        previousChanged = false;
        continue;
      }
      const run = previousChanged ? runs[runs.length - 1] : undefined;
      if (run) {
        run.blocks.push({ element, kind });
        if (run.kind !== kind) run.kind = "modified";
      } else {
        runs.push({ kind, blocks: [{ element, kind }] });
      }
      previousChanged = true;
    }
  }
  return runs.length === 0 ? EMPTY_CHANGE_RUNS : runs;
}

function changeUnits(segment: Element): HTMLElement[] {
  if (segment.hasAttribute("data-change")) return [segment as HTMLElement];
  return Array.from(segment.children).flatMap(blockUnits) as HTMLElement[];
}

// A bar beside a whole list, table, or quote would hide which item changed, so their items, rows, and
// paragraphs are marked one by one, down through nested lists.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/709
function blockUnits(block: Element): Element[] {
  if (block.matches("ul, ol, blockquote")) return Array.from(block.children).flatMap(blockUnits);
  if (block.matches("table")) return Array.from(block.querySelectorAll(":scope > * > tr"));
  if (!block.matches("li")) return [block];
  return [
    block,
    ...Array.from(block.querySelectorAll(":scope > ul, :scope > ol")).flatMap(blockUnits),
  ];
}

function changeKind(element: Element): ChangeKind | null {
  const owns = (marker: Element): boolean =>
    !element.matches("li") || marker.closest("li") === element;
  const marked = (selector: string): boolean =>
    element.matches(selector) || Array.from(element.querySelectorAll(selector)).some(owns);
  const inserted = marked(INSERTED);
  const deleted = marked(DELETED);
  if (inserted && deleted) return "modified";
  if (inserted) return "inserted";
  return deleted ? "deleted" : null;
}

function decorateMarkdown(container: HTMLElement): void {
  applySentinels(container);
  disableTaskCheckboxes(container);
}

// Rendered task boxes carry the real note path, so a click would rewrite the note from a read-only diff.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
function disableTaskCheckboxes(container: HTMLElement): void {
  for (const box of container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    box.disabled = true;
  }
}

interface CodeDiffViewProps {
  lines: readonly CodeDiffLine[];
}

function CodeDiffView({ lines }: CodeDiffViewProps): React.ReactElement {
  return (
    <pre className="tw-overflow-x-auto tw-whitespace-pre-wrap tw-rounded-sm tw-bg-secondary tw-p-2 tw-text-smaller">
      {lines.map((line, index) => (
        <div
          // eslint-disable-next-line @eslint-react/no-array-index-key -- line order is the only identity a verbatim line diff has
          key={index}
          data-change={line.change}
          className={cn(
            line.change === "deleted" && "tw-bg-error",
            line.change === "inserted" && "tw-bg-success"
          )}
        >
          {line.text === "" ? " " : line.text}
        </div>
      ))}
    </pre>
  );
}
