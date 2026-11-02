import type { DiffRun, LineRange } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { diffArrays } from "diff";

export interface RevokedRun {
  after: string;
  current: string;
}

// The run's lines must reach the current note untouched and in order. A run that only removed text
// leaves nothing of its own to find, so the line on each side of it must reach the note too. The run
// is found by its first non-blank line, since a diff may pair its blank edge with another blank line.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
export function locateRun(after: string, current: string, run: DiffRun): LineRange | null {
  const afterLines = after.split("\n");
  const currentLines = current.split("\n");
  const removalOnly = afterLines
    .slice(run.after.start, run.after.end)
    .every((line) => line.trim() === "");
  const from = removalOnly ? Math.max(run.after.start - 1, 0) : run.after.start;
  const region = afterLines.slice(from, removalOnly ? run.after.end + 1 : run.after.end);
  const anchor = Math.max(
    region.findIndex((line) => line.trim() !== ""),
    0
  );
  const anchorLine = currentLineOf(afterLines, currentLines, from + anchor);
  const start = anchorLine === null ? -1 : anchorLine - anchor;
  if (start < 0 || region.some((line, offset) => currentLines[start + offset] !== line))
    return null;
  return { start: start + run.after.start - from, end: start + run.after.end - from };
}

function currentLineOf(afterLines: string[], currentLines: string[], line: number): number | null {
  let afterLine = 0;
  let currentLine = 0;
  for (const part of diffArrays(afterLines, currentLines)) {
    const count = part.value.length;
    if (!part.added && line < afterLine + count) {
      return part.removed ? null : currentLine + line - afterLine;
    }
    if (!part.added) afterLine += count;
    if (!part.removed) currentLine += count;
  }
  return null;
}

export function revokeRun(
  before: string,
  after: string,
  current: string,
  run: DiffRun
): RevokedRun | null {
  const target = locateRun(after, current, run);
  if (target === null) return null;
  const restored = before.split("\n").slice(run.before.start, run.before.end);
  return {
    after: spliceLines(after, run.after, restored),
    current: spliceLines(current, target, restored),
  };
}

function spliceLines(text: string, range: LineRange, lines: readonly string[]): string {
  const result = text.split("\n");
  result.splice(range.start, range.end - range.start, ...lines);
  return result.join("\n");
}
