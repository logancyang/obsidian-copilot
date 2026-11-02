import { alignBlocks } from "@/agentMode/ui/renderedDiff/alignBlocks";
import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
  SENTINEL,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import type { MarkdownBlock, MarkdownSplit } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { splitMarkdown } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffTableBlock } from "@/agentMode/ui/renderedDiff/tableDiff";
import { diffTextBlock } from "@/agentMode/ui/renderedDiff/tokenDiff";
import { logWarn } from "@/logger";
import { diffLines } from "diff";
import type { App } from "obsidian";

export type DiffChange = "unchanged" | "deleted" | "inserted";

export interface LineRange {
  start: number;
  end: number;
}

export interface DiffRun {
  before: LineRange;
  after: LineRange;
}

export interface CodeDiffLine {
  change: DiffChange;
  text: string;
  run?: DiffRun;
}

export type DiffSegment =
  | { kind: "markdown"; markdown: string; continuesList?: true; run?: DiffRun }
  | {
      kind: "block";
      change: "deleted" | "inserted";
      markdown: string;
      continuesList?: true;
      run?: DiffRun;
    }
  | { kind: "code"; lines: CodeDiffLine[]; run?: DiffRun };

const EMPTY_PLAN: readonly DiffSegment[] = Object.freeze([]);

const VISIBLE_MARK = new RegExp(`[${INS_OPEN}${DEL_OPEN}]\\s*[^\\s${INS_CLOSE}${DEL_CLOSE}]`);

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

// A run spans everything between two unchanged stretches, blank lines included, so revoking it
// restores that stretch exactly. Ranges index the text's "\n"-split lines, so they hold for the raw
// text as well as its CRLF-normalized copy.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
class RunTracker {
  private open: DiffRun | null = null;
  private beforeLine = 0;
  private afterLine = 0;

  changed(): DiffRun {
    this.open ??= {
      before: { start: this.beforeLine, end: this.beforeLine },
      after: { start: this.afterLine, end: this.afterLine },
    };
    return this.open;
  }

  unchanged(before: LineRange, after: LineRange): void {
    if (this.open) {
      this.open.before.end = before.start;
      this.open.after.end = after.start;
      this.open = null;
    }
    this.beforeLine = before.end;
    this.afterLine = after.end;
  }

  finish(before: string, after: string): void {
    const beforeEnd = lineCount(before);
    const afterEnd = lineCount(after);
    this.unchanged({ start: beforeEnd, end: beforeEnd }, { start: afterEnd, end: afterEnd });
  }
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

function linesAt(start: number, text: string): LineRange {
  return { start, end: start + lineCount(text) };
}

export function diffCodeLines(before: string, after: string): CodeDiffLine[] {
  return codeLines(before, after);
}

function codeLines(before: string, after: string, runs?: RunTracker): CodeDiffLine[] {
  const lines: CodeDiffLine[] = [];
  let beforeLine = 0;
  let afterLine = 0;
  for (const part of diffLines(before, after)) {
    const change: DiffChange = part.added ? "inserted" : part.removed ? "deleted" : "unchanged";
    const count = part.count ?? 0;
    if (change === "unchanged") {
      runs?.unchanged(
        { start: beforeLine, end: beforeLine + count },
        { start: afterLine, end: afterLine + count }
      );
    }
    if (!part.added) beforeLine += count;
    if (!part.removed) afterLine += count;
    const run = change === "unchanged" ? undefined : runs?.changed();
    const terminated = part.value.endsWith("\n");
    const texts = part.value.split("\n");
    if (terminated) texts.pop();
    for (const text of texts) lines.push({ change, text, run });
    // Normalizing final newlines hides real edits; annotate only differing termination.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
    if (!terminated && before.endsWith("\n") !== after.endsWith("\n")) {
      lines.push({ change, text: "\\ No newline at end of file", run });
    }
  }
  runs?.finish(before, after);
  return lines;
}

export async function buildRenderedDiffPlan(
  app: App,
  before: string | null,
  after: string | null,
  markdown: boolean
): Promise<readonly DiffSegment[]> {
  // A CRLF-to-LF conversion would otherwise mark every line changed; the engine assumes LF.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const beforeText = (before ?? "").replace(/\r\n/g, "\n");
  const afterText = (after ?? "").replace(/\r\n/g, "\n");
  // Raw sentinel characters would be consumed as diff markup, corrupting note text.
  // Preserve them verbatim: https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (!markdown || SENTINEL.test(beforeText) || SENTINEL.test(afterText)) {
    return verbatimPlan(beforeText, afterText);
  }

  let beforeSplit: MarkdownSplit;
  let afterSplit: MarkdownSplit;
  try {
    [beforeSplit, afterSplit] = await Promise.all([
      splitMarkdown(app, beforeText),
      splitMarkdown(app, afterText),
    ]);
  } catch (error) {
    // Obsidian's parser is a private API that may disappear; a line diff still shows every change.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
    logWarn("[RenderedDiff] Markdown parsing failed, showing a line diff", error);
    return verbatimPlan(beforeText, afterText);
  }
  const segments: DiffSegment[] = [];
  const runs = new RunTracker();
  // Unchanged frontmatter stays out of the diff: showing it above every change buries the edit.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  if (beforeSplit.frontmatter !== afterSplit.frontmatter) {
    segments.push({
      kind: "code",
      lines: diffCodeLines(beforeSplit.frontmatter ?? "", afterSplit.frontmatter ?? ""),
      run: runs.changed(),
    });
  } else if (afterSplit.frontmatter !== null) {
    const frontmatter = linesAt(0, afterSplit.frontmatter);
    runs.unchanged(frontmatter, frontmatter);
  }

  for (const pairing of alignBlocks(beforeSplit.blocks, afterSplit.blocks)) {
    let run: DiffRun | undefined;
    if (pairing.kind === "unchanged") {
      runs.unchanged(
        linesAt(pairing.before.line, pairing.before.text),
        linesAt(pairing.after.line, pairing.after.text)
      );
    } else {
      run = runs.changed();
    }
    const { extraBlankLines } = pairing.kind === "deleted" ? pairing.before : pairing.after;
    // A spacer holds the blank lines rendering would merge, as Live Preview shows them, inside the
    // Markdown so reference links and footnotes still find their definitions across it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/751
    if (extraBlankLines) {
      segments.push({
        kind: "markdown",
        markdown: `<div aria-hidden="true">${"<br>".repeat(extraBlankLines)}</div>`,
        run,
      });
    }
    switch (pairing.kind) {
      case "unchanged":
        segments.push({
          kind: "markdown",
          markdown: pairing.after.text,
          continuesList: pairing.after.continuesList,
        });
        break;
      case "deleted":
        segments.push({
          kind: "block",
          change: "deleted",
          markdown: pairing.before.text,
          continuesList: pairing.before.continuesList,
          run,
        });
        break;
      case "inserted":
        segments.push({
          kind: "block",
          change: "inserted",
          markdown: pairing.after.text,
          continuesList: pairing.after.continuesList,
          run,
        });
        break;
      default:
        for (const segment of modifiedSegments(pairing.before, pairing.after)) {
          segments.push({ ...segment, run });
        }
    }
  }
  runs.finish(beforeText, afterText);
  const collapsed = collapseSegments(segments);
  // Rendering hides whitespace-only edits such as blank lines or marked spaces, so show those verbatim.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const rendersChange = collapsed.some(
    (segment) => segment.kind !== "markdown" || VISIBLE_MARK.test(segment.markdown)
  );
  if (!rendersChange && beforeText !== afterText) return verbatimPlan(beforeText, afterText);
  return collapsed.length === 0 ? EMPTY_PLAN : collapsed;
}

function verbatimPlan(before: string, after: string): readonly DiffSegment[] {
  const lines = codeLines(before, after, new RunTracker());
  return lines.length === 0 ? EMPTY_PLAN : [{ kind: "code", lines }];
}

function modifiedSegments(before: MarkdownBlock, after: MarkdownBlock): DiffSegment[] {
  if (after.type === "code") {
    return [{ kind: "code", lines: diffCodeLines(before.text, after.text) }];
  }
  if (after.type === "table") {
    const merged = diffTableBlock(before.text, after.text);
    if (merged !== null) return [{ kind: "markdown", markdown: merged }];
    return [
      { kind: "block", change: "deleted", markdown: before.text },
      { kind: "block", change: "inserted", markdown: after.text },
    ];
  }
  return [
    {
      kind: "markdown",
      markdown: diffTextBlock(before.text, after.text),
      continuesList: after.continuesList,
    },
  ];
}

// A row of blocks with the same change renders as one region, so its paragraphs keep their gaps
// inside one highlight and its list items stay one list.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/751
// Blocks never merge across a run boundary, so each run renders as its own revocable region.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
function collapseSegments(segments: readonly DiffSegment[]): DiffSegment[] {
  const collapsed: DiffSegment[] = [];
  for (const segment of segments) {
    const previous = collapsed[collapsed.length - 1];
    if (previous === undefined || previous.run !== segment.run) {
      collapsed.push(segment);
      continue;
    }
    if (
      (previous.kind === "markdown" && segment.kind === "markdown") ||
      (previous.kind === "block" && segment.kind === "block" && previous.change === segment.change)
    ) {
      collapsed[collapsed.length - 1] = {
        ...previous,
        markdown: `${previous.markdown}${segment.continuesList ? "\n" : "\n\n"}${segment.markdown}`,
      };
      continue;
    }
    collapsed.push(segment);
  }
  return collapsed;
}
