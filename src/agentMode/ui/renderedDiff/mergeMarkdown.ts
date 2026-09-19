import { alignBlocks } from "@/agentMode/ui/renderedDiff/alignBlocks";
import type { MarkdownBlockType } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { splitBlocks, splitFrontmatter } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffTableBlock } from "@/agentMode/ui/renderedDiff/tableDiff";
import { diffTextBlock } from "@/agentMode/ui/renderedDiff/tokenDiff";
import { diffLines } from "diff";

export type DiffChange = "unchanged" | "deleted" | "inserted";

export interface CodeDiffLine {
  change: DiffChange;
  text: string;
}

export type DiffSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "block"; change: "deleted" | "inserted"; markdown: string }
  | { kind: "code"; lines: CodeDiffLine[] };

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

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

export interface RenderedDiffOptions {
  markdown?: boolean;
}

export function buildRenderedDiffPlan(
  before: string | null,
  after: string | null,
  options: RenderedDiffOptions = {}
): DiffSegment[] {
  const beforeText = before ?? "";
  const afterText = after ?? "";
  // Raw sentinel characters would be consumed as diff markup, corrupting note text.
  // Preserve them verbatim: https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (
    options.markdown === false ||
    /[\uE000-\uE003]/.test(beforeText) ||
    /[\uE000-\uE003]/.test(afterText)
  ) {
    const lines = diffCodeLines(beforeText, afterText);
    return lines.length === 0 ? [] : [{ kind: "code", lines }];
  }

  const beforeSplit = splitFrontmatter(beforeText);
  const afterSplit = splitFrontmatter(afterText);
  const segments: DiffSegment[] = [];
  // Unchanged frontmatter stays out of the diff: showing it above every change buries the edit.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
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
