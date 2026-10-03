import { alignSequences, diceSimilarity } from "@/agentMode/ui/renderedDiff/alignBlocks";
import { diffInline } from "@/agentMode/ui/renderedDiff/tokenDiff";

export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === "\\" && index + 1 < line.length) {
      current += character + line[index + 1];
      index++;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  if (cells[0].trim() === "") cells.shift();
  if (cells.at(-1)?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

// A column-count mismatch returns null: cells could only be matched by guessing, so the caller shows
// the old table removed and the new one added.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
export function diffTableBlock(before: string, after: string): string | null {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const beforeHeader = splitTableRow(beforeLines[0]);
  const afterHeader = splitTableRow(afterLines[0]);
  if (beforeHeader.length !== afterHeader.length) return null;
  const columns = afterHeader.length;

  const merged = [renderRow(diffCells(beforeHeader, afterHeader)), afterLines[1]];
  const beforeRows = beforeLines.slice(2);
  const afterRows = afterLines.slice(2);
  for (const pairing of alignSequences(beforeRows, afterRows, {
    isEqual: (left, right) => left === right,
    similarity: diceSimilarity,
  })) {
    if (pairing.kind === "unchanged") {
      merged.push(pairing.after);
      continue;
    }
    const beforeRow = pairing.kind === "inserted" ? "" : pairing.before;
    const afterRow = pairing.kind === "deleted" ? "" : pairing.after;
    merged.push(renderRow(diffCells(cellsOf(beforeRow, columns), cellsOf(afterRow, columns))));
  }
  return merged.join("\n");
}

function cellsOf(row: string, columns: number): string[] {
  const cells = splitTableRow(row).slice(0, columns);
  while (cells.length < columns) cells.push("");
  return cells;
}

function diffCells(before: readonly string[], after: readonly string[]): string[] {
  return before.map((cell, index) => diffInline(cell, after[index]));
}

function renderRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}
