import type { DiffRun, LineRange } from "@/agentMode/ui/renderedDiff/mergeMarkdown";
import { diffArrays } from "diff";

export interface RevokedRun {
  after: string;
  current: string;
}

// The run's lines must reach the current note untouched and in order. A run that only removed text
// leaves nothing of its own to find, so the line on each side of it must reach the note too.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
export function locateRun(after: string, current: string, run: DiffRun): LineRange | null {
  const afterLines = after.split("\n");
  const removalOnly = afterLines
    .slice(run.after.start, run.after.end)
    .every((line) => line.trim() === "");
  const from = removalOnly ? Math.max(run.after.start - 1, 0) : run.after.start;
  const to = removalOnly ? Math.min(run.after.end + 1, afterLines.length) : run.after.end;
  const kept = new Map<number, number>();
  let afterLine = 0;
  let currentLine = 0;
  for (const part of diffArrays(afterLines, current.split("\n"))) {
    const count = part.value.length;
    if (!part.added && !part.removed) {
      for (let offset = 0; offset < count; offset++) {
        kept.set(afterLine + offset, currentLine + offset);
      }
    }
    if (!part.added) afterLine += count;
    if (!part.removed) currentLine += count;
  }
  const start = kept.get(from);
  if (start === undefined) return null;
  for (let line = from; line < to; line++) {
    if (kept.get(line) !== start + line - from) return null;
  }
  return { start: start + run.after.start - from, end: start + run.after.end - from };
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
