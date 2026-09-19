import { alignSequences, diceSimilarity } from "@/agentMode/ui/renderedDiff/alignBlocks";
import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
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
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

// A column-count mismatch returns null: cells could only be matched by guessing, so the caller shows
// the old table removed and the new one added.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
export function diffTableBlock(before: string, after: string): string | null {
  const beforeLines = before.split("\n").filter((line) => line.trim() !== "");
  const afterLines = after.split("\n").filter((line) => line.trim() !== "");
  if (beforeLines.length < 2 || afterLines.length < 2) return null;

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
    if (pairing.kind === "deleted") {
      merged.push(
        renderRow(cellsOf(pairing.before, columns).map((cell) => wrap(cell, DEL_OPEN, DEL_CLOSE)))
      );
      continue;
    }
    if (pairing.kind === "inserted") {
      merged.push(
        renderRow(cellsOf(pairing.after, columns).map((cell) => wrap(cell, INS_OPEN, INS_CLOSE)))
      );
      continue;
    }
    merged.push(
      renderRow(diffCells(cellsOf(pairing.before, columns), cellsOf(pairing.after, columns)))
    );
  }
  return merged.join("\n");
}

function cellsOf(row: string, columns: number): string[] {
  const cells = splitTableRow(row).slice(0, columns);
  while (cells.length < columns) cells.push("");
  return cells;
}

function diffCells(before: readonly string[], after: readonly string[]): string[] {
  const columns = Math.max(before.length, after.length);
  const cells: string[] = [];
  for (let index = 0; index < columns; index++) {
    const left = before[index] ?? "";
    const right = after[index] ?? "";
    if (left === right) cells.push(right);
    else if (left === "") cells.push(wrap(right, INS_OPEN, INS_CLOSE));
    else if (right === "") cells.push(wrap(left, DEL_OPEN, DEL_CLOSE));
    else cells.push(diffInline(left, right));
  }
  return cells;
}

function wrap(cell: string, open: string, close: string): string {
  return cell === "" ? cell : open + cell + close;
}

function renderRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}
