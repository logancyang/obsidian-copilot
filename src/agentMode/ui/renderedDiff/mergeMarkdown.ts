import { alignBlocks } from "@/agentMode/ui/renderedDiff/alignBlocks";
import type { MarkdownBlockType } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { splitBlocks, splitFrontmatter } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffTableBlock } from "@/agentMode/ui/renderedDiff/tableDiff";
import { diffTextBlock } from "@/agentMode/ui/renderedDiff/tokenDiff";
import { diffLines } from "diff";

export type DiffChange = "unchanged" | "deleted" | "inserted";

/** One line of a verbatim line diff, used for code blocks, frontmatter, and non-Markdown files. */
export interface CodeDiffLine {
  change: DiffChange;
  text: string;
}

/**
 * One renderable piece of the merged document, in reading order.
 *
 * `markdown` carries sentinel-bearing Markdown that goes through the Markdown
 * renderer in one pass; `block` carries untouched Markdown that is decorated as a
 * whole; `code` bypasses the renderer entirely.
 */
export type DiffSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "block"; change: "deleted" | "inserted"; markdown: string }
  | { kind: "code"; lines: CodeDiffLine[] };

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * Whether a vault path should be diffed as rendered Markdown. Anything else — a
 * canvas, a JSON sidecar, a CSV — is shown as a verbatim line diff, because
 * rendering it would hide the very characters the diff is about.
 * @param path - Vault-relative path of the changed file.
 */
export function isMarkdownPath(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  if (!name.includes(".")) return false;
  return MARKDOWN_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

/**
 * Diffs two texts line by line without interpreting their content.
 * @param before - Text from the original document.
 * @param after - Text from the edited document.
 */
export function diffCodeLines(before: string, after: string): CodeDiffLine[] {
  const lines: CodeDiffLine[] = [];
  for (const part of diffLines(withTrailingNewline(before), withTrailingNewline(after))) {
    const change: DiffChange = part.added ? "inserted" : part.removed ? "deleted" : "unchanged";
    for (const text of part.value.split("\n").slice(0, -1)) lines.push({ change, text });
  }
  return lines;
}

/** How a file's content should be interpreted while its diff plan is built. */
export interface RenderedDiffOptions {
  /** False for a file whose bytes must be shown verbatim rather than rendered. */
  markdown?: boolean;
}

/**
 * Builds the ordered plan a rendered diff is drawn from: which parts of the
 * merged document go through the Markdown renderer carrying inline sentinels,
 * which are decorated as whole blocks, and which are verbatim line diffs.
 * @param before - File content before the turn, or null when the file was created.
 * @param after - File content after the turn, or null when the file was deleted.
 * @param options - Whether the content is Markdown.
 */
export function buildRenderedDiffPlan(
  before: string | null,
  after: string | null,
  options: RenderedDiffOptions = {}
): DiffSegment[] {
  const beforeText = before ?? "";
  const afterText = after ?? "";
  if (options.markdown === false) {
    const lines = diffCodeLines(beforeText, afterText);
    return lines.length === 0 ? [] : [{ kind: "code", lines }];
  }

  const beforeSplit = splitFrontmatter(beforeText);
  const afterSplit = splitFrontmatter(afterText);
  const segments: DiffSegment[] = [];
  // Frontmatter is split off so no marker can land on its fence, not so it can
  // be put on display: properties the turn left alone are not part of the
  // change, and a block of them above every diff buries the edit below the fold.
  if (beforeSplit.frontmatter !== afterSplit.frontmatter) {
    segments.push({
      kind: "code",
      lines: diffCodeLines(beforeSplit.frontmatter ?? "", afterSplit.frontmatter ?? ""),
    });
  }

  for (const pairing of alignBlocks(splitBlocks(beforeSplit.body), splitBlocks(afterSplit.body))) {
    switch (pairing.kind) {
      case "unchanged":
        segments.push({ kind: "markdown", markdown: pairing.after.text });
        break;
      case "deleted":
        segments.push({ kind: "block", change: "deleted", markdown: pairing.before.text });
        break;
      case "inserted":
        segments.push({ kind: "block", change: "inserted", markdown: pairing.after.text });
        break;
      default:
        segments.push(
          ...modifiedSegments(pairing.before.type, pairing.before.text, pairing.after.text)
        );
    }
  }
  return collapseMarkdown(segments);
}

function modifiedSegments(type: MarkdownBlockType, before: string, after: string): DiffSegment[] {
  if (type === "code") return [{ kind: "code", lines: diffCodeLines(before, after) }];
  if (type === "table") {
    const merged = diffTableBlock(before, after);
    if (merged !== null) return [{ kind: "markdown", markdown: merged }];
    return [
      { kind: "block", change: "deleted", markdown: before },
      { kind: "block", change: "inserted", markdown: after },
    ];
  }
  return [{ kind: "markdown", markdown: diffTextBlock(before, after) }];
}

/**
 * Adjacent Markdown segments are rendered together so multi-block structures — a
 * list interrupted by an edited item, a paragraph following a heading — reach the
 * renderer as one document and keep their spacing and nesting.
 */
function collapseMarkdown(segments: readonly DiffSegment[]): DiffSegment[] {
  const collapsed: DiffSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "markdown") {
      collapsed.push(segment);
      continue;
    }
    if (segment.markdown.trim() === "") continue;
    const previous = collapsed[collapsed.length - 1];
    if (previous?.kind === "markdown") {
      collapsed[collapsed.length - 1] = {
        kind: "markdown",
        markdown: `${previous.markdown}\n\n${segment.markdown}`,
      };
      continue;
    }
    collapsed.push(segment);
  }
  return collapsed;
}

function withTrailingNewline(value: string): string {
  if (value === "") return value;
  return value.endsWith("\n") ? value : `${value}\n`;
}
