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
    () => buildRenderedDiffPlan(before, after, { markdown: isMarkdownPath(path) }),
    [before, after, path]
  );
  return (
    <div>
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
        className={cn(
          segment.change === "deleted" ? "copilot-diff-block-del" : "copilot-diff-block-ins"
        )}
      >
        <Markdown sourcePath={path} text={segment.markdown} />
      </div>
    );
  }
  return <Markdown onRendered={applySentinels} sourcePath={path} text={segment.markdown} />;
}

interface CodeDiffViewProps {
  lines: readonly CodeDiffLine[];
}

function CodeDiffView({ lines }: CodeDiffViewProps): React.ReactElement {
  return (
    <pre className="copilot-diff-code">
      {lines.map((line, index) => (
        <div
          // eslint-disable-next-line @eslint-react/no-array-index-key -- line order is the only identity a verbatim line diff has
          key={index}
          className={cn(
            line.change === "deleted" && "diff-line-del",
            line.change === "inserted" && "diff-line-ins"
          )}
        >
          {line.text === "" ? " " : line.text}
        </div>
      ))}
    </pre>
  );
}
