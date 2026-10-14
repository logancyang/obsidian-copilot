import { applySentinels } from "@/agentMode/ui/renderedDiff/applySentinels";
import type { CodeDiffLine, DiffSegment } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { buildRenderedDiffPlan, isMarkdownPath } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import * as React from "react";

export interface RenderedDiffProps {
  before: string | null;
  after: string | null;
  path: string;
}

interface ResolvedPlan extends RenderedDiffProps {
  segments: readonly DiffSegment[];
}

export function RenderedDiff({
  before,
  after,
  path,
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
    <div className="[--checklist-done-decoration:none]">
      {plan.segments.map((segment, index) => (
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
          segment.change === "deleted"
            ? "tw-bg-error tw-text-muted tw-line-through"
            : "tw-bg-success"
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
