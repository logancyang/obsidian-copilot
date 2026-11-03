import type { DiffRun, LineRange } from "@/agentMode/ui/renderedDiff/mergeMarkdown";

export interface RevokedRun {
  after: string;
  current: string;
}

// The run's lines must reach the current note untouched and in order. A run that only removed text
// leaves nothing of its own to find, so the line on each side of it must reach the note too. Text
// that repeats in the turn's result or in the note could put the revoke on another copy, so the run
// must appear exactly once in each.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/823
export function locateRun(after: string, current: string, run: DiffRun): LineRange | null {
  const afterLines = after.split("\n");
  const removalOnly = afterLines
    .slice(run.after.start, run.after.end)
    .every((line) => line.trim() === "");
  const from = removalOnly ? Math.max(run.after.start - 1, 0) : run.after.start;
  const region = afterLines.slice(from, removalOnly ? run.after.end + 1 : run.after.end);
  const found = occurrences(current.split("\n"), region);
  if (found.length !== 1 || occurrences(afterLines, region).length !== 1) return null;
  return { start: found[0] + run.after.start - from, end: found[0] + run.after.end - from };
}

function occurrences(lines: readonly string[], region: readonly string[]): number[] {
  const starts: number[] = [];
  for (let start = 0; start + region.length <= lines.length; start++) {
    if (region.every((line, offset) => lines[start + offset] === line)) starts.push(start);
  }
  return starts;
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
