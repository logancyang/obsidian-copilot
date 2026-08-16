import type { App } from "obsidian";
// These builders produce absolute, OS-native paths for the desktop-only
// off-vault cache; mobile never reaches them (Agent Mode is desktop-gated).
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { md5 } from "@/utils/hash";
import type { MaterializedSourceType } from "./contextCacheStore";

function joinPath(...parts: string[]): string {
  return requireNodeModule<typeof import("node:path")>("path").join(...parts);
}

/**
 * Single source of truth for where this vault's shared, off-vault conversion
 * cache lives on disk. Both the writer (materializer) and every reader (UI
 * status, preview, Clear command) derive their paths from here, so the layout
 * is defined exactly once.
 *
 * Layout under {@link copilotAppDataDir} (reusing the existing per-vault
 * namespace that already hosts the recent-chats index):
 *
 * ```
 * ~/.obsidian-copilot/vaults/<vaultId>/context-cache/
 *   remotes/   web-<md5(url)>.md · youtube-<md5(url)>.md     (shared across all projects)
 *   files/     file-<md5(vaultPath)>.md                       (vaultId already scopes the parent)
 *   markers/   <md5(projectId)>/failed-<type>-<md5(source)>.json   (failure markers, bucketed per project)
 * ```
 *
 * Off-vault (device-local, not synced) so a source is converted once per vault
 * rather than once per project, and the cache never enters Obsidian Sync / git
 * or pollutes vault-wide agent search. These builders return absolute,
 * OS-native paths and are therefore desktop-only — Agent Mode (their only
 * consumer) is gated behind the desktop runtime boundary.
 *
 * ### Why this cache lives off-vault
 *
 * It exists to hand **absolute file paths** to three external agent subprocesses
 * (claude/codex/opencode) that read the files themselves — so it must live
 * somewhere they can reach, dedupe by source identity across projects, and
 * survive without vault sync.
 */
export function cacheRoot(app: App): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return joinPath(copilotAppDataDir(os.homedir()), "vaults", getVaultId(app), "context-cache");
}

/** Shared snapshots for remote sources (web pages, YouTube transcripts). */
export function remotesDir(app: App): string {
  return joinPath(cacheRoot(app), "remotes");
}

/** Shared snapshots for converted vault binaries (PDF, image, …), keyed by vault path. */
export function filesDir(app: App): string {
  return joinPath(cacheRoot(app), "files");
}

/**
 * Per-project failure markers. Bucketed by `md5(projectId)` because snapshots
 * are shared but a failure is meaningful only to the project that hit it.
 */
export function markersDir(app: App, projectId: string): string {
  return joinPath(cacheRoot(app), "markers", md5(projectId));
}

/**
 * Absolute, OS-native path of a snapshot file, derived from its source kind and
 * basename: remote kinds (web/youtube) live under {@link remotesDir}, converted
 * vault files under {@link filesDir}. The manifest lists this so the agent reads
 * the snapshot directly (the shared cache is outside every project's cwd, so an
 * absolute path is the only pointer reachable across all three backends).
 */
export function snapshotAbsPath(app: App, type: MaterializedSourceType, fileName: string): string {
  return joinPath(type === "file" ? filesDir(app) : remotesDir(app), fileName);
}
