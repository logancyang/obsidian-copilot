import {
  applySentinels,
  type Change,
  frameMedia,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import type { CodeDiffLine, DiffRun, DiffSegment } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { buildRenderedDiffPlan, isMarkdownPath } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { locateRun } from "@/agentMode/ui/renderedDiff/revokeRun";
import { RevokeButton } from "@/agentMode/ui/RevokeButton";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import * as React from "react";

export interface RunRevoke {
  current: string | null;
  onRevoke: (run: DiffRun) => void;
}

export interface RenderedDiffProps {
  before: string | null;
  after: string | null;
  path: string;
  revoke?: RunRevoke;
}

interface ResolvedPlan extends Omit<RenderedDiffProps, "revoke"> {
  segments: readonly DiffSegment[];
}

interface RevokeContextValue {
  after: string;
  revoke: RunRevoke;
}

const RevokeContext = React.createContext<RevokeContextValue | null>(null);

export function RenderedDiff({
  before,
  after,
  path,
  revoke,
}: RenderedDiffProps): React.ReactElement | null {
  const app = useApp();
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
  // A plan built for earlier props would show the previous file's changes under the new path until the new parse lands.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (plan === null || plan.before !== before || plan.after !== after || plan.path !== path) {
    return null;
  }
  return (
    // Strikethrough marks deletions here, so completed tasks drop Obsidian's done strike at every nesting depth.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    // One rendered root spans every segment, so Obsidian's margins collapse between segments as they
    // do between blocks of the note instead of being cut at each segment's first and last child.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/751
    <div className="markdown-rendered [--checklist-done-decoration:none]">
      <RevokeContext.Provider value={revoke ? { after: after ?? "", revoke } : null}>
        {groupByRun(plan.segments).map(({ run, start, items }) => (
          <RunFrame key={start} run={run}>
            {items.map((segment, offset) => (
              <DiffSegmentView
                // eslint-disable-next-line @eslint-react/no-array-index-key -- the plan is rebuilt whole whenever the file content changes and nothing reorders it, so position is a segment identity
                key={start + offset}
                continued={continuesList(plan.segments[start + offset + 1])}
                path={path}
                segment={segment}
              />
            ))}
          </RunFrame>
        ))}
      </RevokeContext.Provider>
    </div>
  );
}

interface RunGroup<T> {
  run: DiffRun | undefined;
  start: number;
  items: T[];
}

function groupByRun<T extends { run?: DiffRun }>(items: readonly T[]): RunGroup<T>[] {
  const groups: RunGroup<T>[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.run === item.run) last.items.push(item);
    else groups.push({ run: item.run, start: index, items: [item] });
  });
  return groups;
}

interface RunFrameProps {
  run: DiffRun | undefined;
  children: React.ReactNode;
}

function RunFrame({ run, children }: RunFrameProps): React.ReactElement {
  const context = React.useContext(RevokeContext);
  const after = context?.after;
  const current = context?.revoke.current;
  const blocked = React.useMemo(() => {
    if (run === undefined || after === undefined || current === undefined) return null;
    if (current === null) return "This note no longer exists.";
    return locateRun(after, current, run) === null
      ? "This text changed in the note after the turn."
      : null;
  }, [after, current, run]);
  if (run === undefined || context === null) return <>{children}</>;
  return (
    <div className="tw-group tw-relative tw-rounded-sm focus-within:tw-ring-1 focus-within:tw-ring-ring hover:tw-ring-1 hover:tw-ring-ring">
      {children}
      <RevokeButton
        label="Revoke"
        blocked={blocked}
        tooltipSide="left"
        className={cn(
          "tw-absolute tw-right-0 tw-top-0 tw-opacity-0",
          blocked === null
            ? "group-focus-within:tw-opacity-100 group-hover:tw-opacity-100"
            : "group-focus-within:tw-opacity-50 group-hover:tw-opacity-50"
        )}
        onRevoke={() => context.revoke.onRevoke(run)}
      />
    </div>
  );
}

interface DiffSegmentViewProps {
  continued: boolean;
  path: string;
  segment: DiffSegment;
}

function continuesList(segment: DiffSegment | undefined): boolean {
  return segment !== undefined && segment.kind !== "code" && segment.continuesList === true;
}

function DiffSegmentView({ continued, path, segment }: DiffSegmentViewProps): React.ReactElement {
  if (segment.kind === "code") return <CodeDiffView lines={segment.lines} />;
  // Obsidian scrolls a lone table by setting overflow-x on its container, which traps the table's
  // margins inside the highlight, so they move onto the container. Items of one list split across
  // segments render as separate lists, so the list margins between them go.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/751
  const spacing = cn(
    "[&[style*=overflow-x]>table]:tw-my-0 [&[style*=overflow-x]]:tw-my-[var(--p-spacing)]",
    segment.continuesList && "[&>:first-child]:tw-mt-0",
    continued && "[&>:last-child]:tw-mb-0"
  );
  if (segment.kind === "block") {
    return (
      <div
        data-change={segment.change}
        className={cn(
          segment.change === "deleted"
            ? "tw-bg-error tw-text-muted tw-line-through"
            : "tw-bg-success"
        )}
      >
        <Markdown
          className={spacing}
          nested
          onRendered={BLOCK_DECORATORS[segment.change]}
          sourcePath={path}
          text={segment.markdown}
        />
      </div>
    );
  }
  return (
    <Markdown
      className={spacing}
      nested
      onRendered={decorateMarkdown}
      sourcePath={path}
      text={segment.markdown}
    />
  );
}

const BLOCK_DECORATORS: Record<Change, (container: HTMLElement) => void> = {
  inserted: (container) => decorateBlock(container, "inserted"),
  deleted: (container) => decorateBlock(container, "deleted"),
};

function decorateBlock(container: HTMLElement, change: Change): void {
  frameMedia(container, change);
  disableTaskCheckboxes(container);
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
      {groupByRun(lines).map(({ run, start, items }) => (
        <RunFrame key={start} run={run}>
          {items.map((line, offset) => (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key -- line order is the only identity a verbatim line diff has
              key={start + offset}
              data-change={line.change}
              className={cn(
                line.change === "deleted" && "tw-bg-error",
                line.change === "inserted" && "tw-bg-success"
              )}
            >
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </RunFrame>
      ))}
    </pre>
  );
}
