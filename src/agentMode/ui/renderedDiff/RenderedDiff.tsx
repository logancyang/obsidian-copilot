import { applySentinels } from "@/agentMode/ui/renderedDiff/applySentinels";
import type { CodeDiffLine, DiffSegment } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { buildRenderedDiffPlan, isMarkdownPath } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import * as React from "react";

export interface RenderedDiffProps {
  before: string | null;
  after: string | null;
  path: string;
}

export function RenderedDiff({ before, after, path }: RenderedDiffProps): React.ReactElement {
  const segments = React.useMemo(
    () => buildRenderedDiffPlan(before, after, isMarkdownPath(path)),
    [before, after, path]
  );
  return (
    // Strikethrough marks deletions here, so completed tasks drop Obsidian's done strike at every nesting depth.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    <div className="[--checklist-done-decoration:none]">
      {segments.map((segment, index) => (
        <DiffSegmentView
          // eslint-disable-next-line @eslint-react/no-array-index-key -- the plan is rebuilt whole whenever the file content changes and nothing reorders it, so position is a segment identity
          key={index}
          path={path}
          segment={segment}
        />
      ))}
    </div>
  );
}

interface DiffSegmentViewProps {
  path: string;
  segment: DiffSegment;
}

function DiffSegmentView({ path, segment }: DiffSegmentViewProps): React.ReactElement {
  if (segment.kind === "code") return <CodeDiffView lines={segment.lines} />;
  if (segment.kind === "block") {
    return (
      <div
        data-change={segment.change}
        className={cn(
          "tw-border-0 tw-border-l-[3px] tw-border-solid tw-pl-[0.5em]",
          segment.change === "deleted"
            ? "tw-border-l-[color:rgba(var(--color-red-rgb),0.6)] tw-bg-error tw-text-muted tw-line-through"
            : "tw-border-l-[color:rgba(var(--color-green-rgb),0.6)] tw-bg-success"
        )}
      >
        <Markdown onRendered={disableTaskCheckboxes} sourcePath={path} text={segment.markdown} />
      </div>
    );
  }
  return <Markdown onRendered={decorateMarkdown} sourcePath={path} text={segment.markdown} />;
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
