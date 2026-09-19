import { applySentinels } from "@/agentMode/ui/renderedDiff/applySentinels";
import type { CodeDiffLine, DiffSegment } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { buildRenderedDiffPlan, isMarkdownPath } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import * as React from "react";

export interface RenderedDiffProps {
  /** File content before the turn, or null when the agent created the file. */
  before: string | null;
  /** File content after the turn, or null when the agent deleted the file. */
  after: string | null;
  /** Vault-relative path; decides Markdown versus verbatim rendering and resolves links. */
  path: string;
}

/**
 * Renders one file's before and after as a single continuous document: unchanged
 * content reads normally, removed text is struck through, and added text is
 * highlighted, all in place.
 * @param props - The two versions of the file and the vault path they belong to.
 */
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
