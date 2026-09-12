import { renderDiff } from "@/agentMode/ui/diffRender";
import { cn } from "@/lib/utils";
import React, { useMemo } from "react";

interface ToolDiffPreviewProps {
  oldText: string | null;
  newText: string;
}

/** Shared, read-only changed-hunk view for pending and completed tool calls. */
export const ToolDiffPreview: React.FC<ToolDiffPreviewProps> = ({ oldText, newText }) => {
  const lines = useMemo(() => renderDiff(oldText, newText).split("\n"), [oldText, newText]);
  const displayLines = lines.map((line) => {
    if (!line.startsWith("+") && !line.startsWith("-")) return line;
    // Make indentation and hard-break edits visible without altering the source snapshots:
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/350
    return (
      line[0] +
      line
        .slice(1)
        .replace(/^[ \t]+|[ \t]+$|\t/g, (space) => space.replace(/ /g, "·").replace(/\t/g, "→"))
    );
  });
  const showsWhitespace = displayLines.some((line, index) => line !== lines[index]);

  return (
    <div className="tw-min-w-0">
      {showsWhitespace && (
        <p className="tw-m-0 tw-mb-1 tw-text-ui-small tw-text-muted">Whitespace: · space, → tab</p>
      )}
      <pre
        role="region"
        aria-label="File changes"
        tabIndex={0}
        className="tw-m-0 tw-max-h-96 tw-overflow-auto tw-whitespace-pre-wrap tw-break-words tw-rounded tw-font-mono tw-text-sm tw-leading-normal focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-current"
      >
        {displayLines.map((line, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are a complete immutable snapshot per render
          <React.Fragment key={index}>
            <span
              className={cn(
                line.startsWith("+") && "tw-bg-success tw-text-success",
                line.startsWith("-") && "tw-bg-error tw-text-error",
                line.startsWith("@@") && "tw-text-muted"
              )}
            >
              {line}
            </span>
            {index < displayLines.length - 1 ? "\n" : null}
          </React.Fragment>
        ))}
      </pre>
    </div>
  );
};
