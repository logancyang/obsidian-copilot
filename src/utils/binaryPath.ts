import * as fs from "node:fs";
import * as os from "node:os";

import { collapseHomeDir } from "@/utils/pathUtils";
import { resolveNodeToolBinDirs } from "@/utils/nodeToolBinDirs";

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
 * Read the live Node version-manager bin dirs (nvm/fnm/Volta/asdf/n/npm-global)
 * from the real environment + filesystem. Shared by detect-time and spawn-time
 * PATH augmentation so a binary found under e.g. nvm also spawns with the same
 * nvm `node` on PATH.
 */
function nodeToolBinDirs(): string[] {
  return resolveNodeToolBinDirs({
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  });
}

/**
 * Directories searched during detection, in priority order: version-manager
 * bins ahead of {@link WELL_KNOWN_BIN_DIRS}. Surfaced in the UI's "not found"
 * hint so users can see where we actually looked. Spawn-time augmentation
 * (`augmentPathForNodeShebang`) reuses this so detect-time and spawn-time PATH
 * stay in lockstep.
 *
 * {@link WELL_KNOWN_BIN_DIRS} are POSIX prefixes that never resolve on Windows,
 * so they're omitted there — otherwise they'd only clutter the Windows PATH and
 * mislead the "Searched:" hint with `/usr/bin`-style paths.
 */
export function detectionSearchDirs(): string[] {
  const wellKnown = process.platform === "win32" ? [] : WELL_KNOWN_BIN_DIRS;
  return [...nodeToolBinDirs(), ...wellKnown];
}

/**
 * Augment PATH for the *detection* step, where we don't yet know the
 * binary's location. Prepends the live version-manager bin dirs and
 * {@link WELL_KNOWN_BIN_DIRS} to the inherited PATH so `which`/`where` invoked
 * from a macOS GUI app finds Homebrew, npm-global, and nvm/fnm/asdf/Volta
 * installs that `launchd`'s sparse default PATH omits.
 */
export function augmentPathForDetection(inherited: string | undefined): string {
  return mergePath(detectionSearchDirs(), inherited);
}

/**
 * Format an absolute binary path for display by collapsing the user's home
 * directory to `~` (e.g. `/Users/alice/.local/bin/claude` →
 * `~/.local/bin/claude`). Avoids leaking the OS username in the settings UI
 * and in screenshots users share when reporting issues.
 *
 * Display-only — the stored/spawned path keeps its real absolute form.
 */
export function formatBinaryPathForDisplay(absolutePath: string): string {
  return collapseHomeDir(absolutePath, os.homedir(), process.platform === "win32");
}
