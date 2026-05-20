/**
 * Well-known POSIX install prefixes that macOS GUI apps' inherited PATH
 * typically omits. Shared between spawn-time PATH augmentation (so
 * `#!/usr/bin/env node` shebangs resolve) and detect-time PATH augmentation
 * (so `which <binary>` finds Homebrew / npm-global installs).
 *
 * macOS GUI apps launched from Finder/Dock get a sparse PATH from `launchd`
 * (typically `/usr/bin:/bin:/usr/sbin:/sbin`) and do NOT inherit the user's
 * shell rc PATH.
 */
export const WELL_KNOWN_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
] as const;

const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";

/**
 * Merge `candidates` with the inherited PATH, deduping while preserving
 * order. Candidates are prepended so they take priority over whatever the
 * GUI shell already had.
 */
export function mergePath(candidates: readonly string[], inherited: string | undefined): string {
  const inheritedParts = (inherited ?? "").split(PATH_SEPARATOR).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...candidates, ...inheritedParts]) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  return merged.join(PATH_SEPARATOR);
}

/**
 * Augment PATH for the *detection* step, where we don't yet know the
 * binary's location. Prepends {@link WELL_KNOWN_BIN_DIRS} to the inherited
 * PATH so `which <name>` invoked from a macOS GUI app finds Homebrew /
 * `/usr/local/bin` installs that `launchd`'s sparse default PATH omits.
 */
export function augmentPathForDetection(inherited: string | undefined): string {
  return mergePath(WELL_KNOWN_BIN_DIRS, inherited);
}
