import { isCapturableVaultPath, toVaultTargetPath } from "@/agentMode/session/editTargets";
import type { TurnDiff, TurnFileChange } from "@/agentMode/session/types";
import { applyPatch, diffLines, parsePatch, reversePatch, type StructuredPatch } from "diff";

export interface TurnFileCapture {
  origin: string | null;
  path: string | null;
  edited: boolean;
  snapshot: Promise<string | null>;
  writeTimeBefore?: string | null;
}

export type ReadVaultText = (path: string) => Promise<string | null>;

const NO_TEXT: Promise<string | null> = Promise.resolve(null);

function isAtOrUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

// Captures follow file identity, not paths, so a note's edits survive a move and a reused path stays its own change.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/763
export class FileCaptures {
  private files: TurnFileCapture[] = [];

  hasEdits(): boolean {
    return this.files.some((file) => file.edited);
  }

  observe(path: string, readText: ReadVaultText): TurnFileCapture {
    const existing = this.at(path);
    if (existing) return existing;
    // A path whose original file already moved or was deleted holds a file made during the turn.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/763
    const origin = this.hasOrigin(path) ? null : path;
    // Read as the call is announced; an Auto-mode write can land first, so a write-time original wins.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/687
    const capture = {
      origin,
      path,
      edited: false,
      snapshot: origin === null ? NO_TEXT : readText(path),
    };
    this.files.push(capture);
    return capture;
  }

  vaultCreated(path: string, adopt: boolean): void {
    if (!isCapturableVaultPath(path)) return;
    const existing = this.at(path);
    if (existing) existing.edited = true;
    else if (adopt) this.files.push({ origin: null, path, edited: true, snapshot: NO_TEXT });
  }

  vaultRenamed(oldPath: string, newPath: string, adopt: boolean, readText: ReadVaultText): void {
    if (!isCapturableVaultPath(newPath)) return this.vaultDeleted(oldPath);
    if (!isCapturableVaultPath(oldPath)) return this.vaultCreated(newPath, adopt);
    const moved = this.files.flatMap((file) =>
      file.path !== null && isAtOrUnder(file.path, oldPath)
        ? [{ file, next: newPath + file.path.slice(oldPath.length) }]
        : []
    );
    if (moved.length === 0) {
      // A folder rename also reports each child, so a destination already followed is a repeat.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/763
      if (!adopt || this.at(newPath)) return;
      const origin = this.hasOrigin(oldPath) ? null : oldPath;
      this.files.push({
        origin,
        path: newPath,
        edited: true,
        snapshot: origin === null ? NO_TEXT : readText(newPath),
      });
      return;
    }
    for (const { file, next } of moved) {
      // The vault cannot rename onto an existing file, so a capture already at the destination was announced
      // for this same move and must not add a creation beside it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/763
      this.files = this.files.filter((other) => other.path !== next);
      file.path = next;
      file.edited = true;
    }
  }

  vaultDeleted(path: string): void {
    for (const file of this.files) {
      if (file.path === null || !isAtOrUnder(file.path, path)) continue;
      file.path = null;
      file.edited = true;
    }
  }

  async changes(
    readText: ReadVaultText,
    turnPatches?: ReadonlyMap<string, StructuredPatch>
  ): Promise<TurnFileChange[]> {
    const paths = new Set<string>();
    for (const file of this.files) {
      if (!file.edited) continue;
      if (file.path !== null) paths.add(file.path);
      if (file.origin !== null && !this.isShownAsRename(file)) paths.add(file.origin);
    }
    const changes = await Promise.all(
      [...paths].map(async (path) => {
        const after = await readText(path);
        return buildTurnFileChange(path, await this.beforeAt(path, after, turnPatches), after);
      })
    );
    return changes.filter((change): change is TurnFileChange => change !== null);
  }

  // Before text comes from a source that saw the file at write time; the first-mention snapshot
  // is only the fallback. https://github.com/Brevilabs/obsidian-copilot-private/issues/347
  private async beforeAt(
    path: string,
    after: string | null,
    turnPatches: ReadonlyMap<string, StructuredPatch> | undefined
  ): Promise<string | null> {
    const original = this.files.find((file) => file.origin === path);
    const renamedHere = this.at(path);
    const source =
      original && !this.isShownAsRename(original)
        ? original
        : renamedHere && this.isShownAsRename(renamedHere)
          ? renamedHere
          : undefined;
    if (!source) return null;
    if (source.writeTimeBefore !== undefined) return source.writeTimeBefore;
    const patch = source === original ? turnPatches?.get(path) : undefined;
    const reverted = patch ? revertFilePatch(patch, after) : undefined;
    return reverted === undefined ? source.snapshot : reverted;
  }

  // A move shows once, at its destination, unless that path had its own original file to compare against.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/763
  private isShownAsRename(file: TurnFileCapture): boolean {
    return (
      file.path !== null &&
      file.origin !== null &&
      file.origin !== file.path &&
      !this.hasOrigin(file.path)
    );
  }

  private hasOrigin(path: string): boolean {
    return this.files.some((file) => file.origin === path);
  }

  private at(path: string): TurnFileCapture | undefined {
    return this.files.find((file) => file.path === path);
  }
}

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
  // A null side means the file was absent, so emptying a file stays a modification, not a delete.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
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
