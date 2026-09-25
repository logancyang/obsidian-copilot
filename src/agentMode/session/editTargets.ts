import { isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";

/**
 * The file-target carrying fields of one tool call, normalized across the two
 * shapes that describe the same call: the wire snapshot/delta a backend emits
 * (`rawInput` + `content`) and the stored message part the trail renders
 * (`input` + `output`). Callers map their own field names onto these.
 */
export interface EditTargetSource {
  /** Tool-reported file locations; the first entry is the call's primary target. */
  locations?: ReadonlyArray<{ path?: string | null }> | null;
  /** Tool input object, searched for `file_path`, `filePath`, then `path`. */
  input?: unknown;
  /** Paths named by the call's diff outputs — see {@link diffTargetPaths}. */
  diffPaths?: readonly string[];
}

/** Deduped file paths named by a tool call's diff-shaped outputs, in arrival order. */
export function diffTargetPaths(
  outputs: ReadonlyArray<{ type: string; path?: string | null }> | null | undefined
): string[] {
  const paths = new Set<string>();
  for (const output of outputs ?? []) {
    if (output.type === "diff" && typeof output.path === "string" && output.path.length > 0) {
      paths.add(output.path);
    }
  }
  return [...paths];
}

/**
 * The single file a tool call is about, vault-relative when it resolves inside
 * the vault. Backends disagree on where the target lives — ACP reports
 * `locations`, Claude Code puts it in the tool input under one of three key
 * spellings, and a batch patch tool only names it in its diff output — so all
 * four are tried in decreasing order of authority. Returns null when the call
 * has no single target (no path at all, or a patch spanning several files).
 *
 * @param source - The tool call's normalized target-carrying fields.
 * @param vaultBase - Vault root absolute path, or null when unavailable.
 */
export function primaryEditTargetPath(
  source: EditTargetSource,
  vaultBase: string | null
): string | null {
  const loc = source.locations?.[0]?.path;
  if (typeof loc === "string" && loc.length > 0) return toVaultRelative(loc, vaultBase);
  const input = source.input as
    | { file_path?: unknown; filePath?: unknown; path?: unknown }
    | null
    | undefined;
  if (typeof input?.file_path === "string") return toVaultRelative(input.file_path, vaultBase);
  if (typeof input?.filePath === "string") return toVaultRelative(input.filePath, vaultBase);
  if (typeof input?.path === "string") return toVaultRelative(input.path, vaultBase);
  const diffPaths = source.diffPaths ?? [];
  if (diffPaths.length === 1) return toVaultRelative(diffPaths[0], vaultBase);
  return null;
}

/**
 * Every file a tool call touches, vault-relative and deduped. A batch patch
 * tool (codex `apply_patch`) rewrites several files in one call, so the diff
 * outputs and locations are unioned rather than resolved to one winner.
 *
 * @param source - The tool call's normalized target-carrying fields.
 * @param vaultBase - Vault root absolute path, or null when unavailable.
 */
export function editTargetPaths(source: EditTargetSource, vaultBase: string | null): string[] {
  const paths = new Set<string>();
  for (const loc of source.locations ?? []) {
    if (typeof loc?.path === "string" && loc.path.length > 0) {
      paths.add(toVaultRelative(loc.path, vaultBase));
    }
  }
  const primary = primaryEditTargetPath({ input: source.input }, vaultBase);
  if (primary) paths.add(primary);
  for (const diffPath of source.diffPaths ?? []) {
    paths.add(toVaultRelative(diffPath, vaultBase));
  }
  return [...paths];
}

/**
 * Whether a resolved path names a vault file whose content may be snapshotted.
 * An absolute path never resolved against the vault root, so it lives outside
 * the vault; a dot-segment names configuration Obsidian hides from the user
 * (`.obsidian/…`) or escapes the vault (`..`). Neither is a note a reader would
 * expect to review.
 */
export function isCapturableVaultPath(path: string): boolean {
  // Backslash paths must not bypass snapshot exclusions for hidden files or paths outside the vault.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/347
  path = path.replace(/\\/g, "/");
  if (path.length === 0 || isAbsolutePath(path)) return false;
  return !path.split("/").some((segment) => segment.startsWith("."));
}
