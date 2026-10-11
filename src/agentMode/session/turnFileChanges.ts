import { toVaultTargetPath } from "@/agentMode/session/editTargets";
import type { TurnDiff, TurnFileChange } from "@/agentMode/session/types";
import { applyPatch, diffLines, parsePatch, reversePatch, type StructuredPatch } from "diff";

export function buildTurnFileChange(
  path: string,
  before: string | null,
  after: string | null
): TurnFileChange | null {
  if (before === after) return null;
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before ?? "", after ?? "")) {
    if (part.added) additions += part.count ?? 0;
    else if (part.removed) deletions += part.count ?? 0;
  }
  const status = before === null ? "created" : after === null ? "deleted" : "modified";
  return { path, status, before, after, additions, deletions };
}

function diffSidePath(fileName: string | undefined): string | null {
  if (!fileName || fileName === "/dev/null") return null;
  return fileName.replace(/^[ab]\//, "");
}

export function filePatchesByVaultPath(
  turnDiff: TurnDiff,
  vaultBase: string | null
): ReadonlyMap<string, StructuredPatch> {
  const root = turnDiff.root.replace(/[\\/]+$/, "");
  const patches = new Map<string, StructuredPatch>();
  for (const patch of parsePatch(turnDiff.unifiedDiff)) {
    const oldPath = diffSidePath(patch.oldFileName);
    const newPath = diffSidePath(patch.newFileName);
    // A rename is a delete plus a create, so each path keeps its own snapshot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
    if (oldPath !== null && newPath !== null && oldPath !== newPath) continue;
    const relativePath = newPath ?? oldPath;
    if (relativePath === null) continue;
    patches.set(toVaultTargetPath(`${root}/${relativePath}`, vaultBase), patch);
  }
  return patches;
}

export function revertFilePatch(
  patch: StructuredPatch,
  after: string | null
): string | null | undefined {
  if (diffSidePath(patch.oldFileName) === null) return null;
  const deleted = diffSidePath(patch.newFileName) === null;
  if (deleted !== (after === null)) return undefined;
  const before = applyPatch(after ?? "", reversePatch(patch));
  return before === false ? undefined : before;
}
