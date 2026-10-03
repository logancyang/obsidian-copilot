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

const SENTINEL_MARK = /[\uE000-\uE003]/;

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function diffCodeLines(before: string, after: string): CodeDiffLine[] {
  const lines: CodeDiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const change: DiffChange = part.added ? "inserted" : part.removed ? "deleted" : "unchanged";
    const terminated = part.value.endsWith("\n");
    const texts = part.value.split("\n");
    if (terminated) texts.pop();
    for (const text of texts) lines.push({ change, text });
    // Normalizing final newlines hides real edits; annotate only differing termination.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
    if (!terminated && before.endsWith("\n") !== after.endsWith("\n")) {
      lines.push({ change, text: "\\ No newline at end of file" });
    }
  }
  return lines;
}

export function buildRenderedDiffPlan(
  before: string | null,
  after: string | null,
  markdown: boolean
): DiffSegment[] {
  // A CRLF-to-LF conversion would otherwise mark every line changed; the engine assumes LF.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const beforeText = (before ?? "").replace(/\r\n/g, "\n");
  const afterText = (after ?? "").replace(/\r\n/g, "\n");
  // Raw sentinel characters would be consumed as diff markup, corrupting note text.
  // Preserve them verbatim: https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!markdown || SENTINEL_MARK.test(beforeText) || SENTINEL_MARK.test(afterText)) {
    return verbatimPlan(beforeText, afterText);
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
  const collapsed = collapseMarkdown(segments);
  // Rendering hides whitespace-only edits such as blank lines, so show those verbatim.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const rendersChange = collapsed.some(
    (segment) => segment.kind !== "markdown" || SENTINEL_MARK.test(segment.markdown)
  );
  return rendersChange || beforeText === afterText
    ? collapsed
    : verbatimPlan(beforeText, afterText);
}

function verbatimPlan(before: string, after: string): DiffSegment[] {
  const lines = diffCodeLines(before, after);
  return lines.length === 0 ? [] : [{ kind: "code", lines }];
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
