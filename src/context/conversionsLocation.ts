import type { App } from "obsidian";
// These builders produce absolute, OS-native paths for the desktop-only
// off-vault cache; mobile never reaches them (Agent Mode is desktop-gated).
// eslint-disable-next-line import/no-nodejs-modules
import os from "node:os";
// eslint-disable-next-line import/no-nodejs-modules
import * as path from "node:path";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { md5 } from "@/utils/hash";
import type { MaterializedSourceType } from "./contextCacheStore";

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
 * ### Why this is a separate stack from CAG's `ProjectContextCache`
 *
 * The two solve different problems and cannot share storage:
 * - CAG's cache is **in-vault** (`.copilot/project-context-cache`, via the
 *   vault adapter), synced, and exists to inline converted text back into the
 *   chat model's prompt as RAG context.
 * - This cache is **off-vault** and exists to hand **absolute file paths** to
 *   three external agent subprocesses (claude/codex/opencode) that read the
 *   files themselves — so it must live somewhere they can reach, dedupe by
 *   source identity across projects, and survive without vault sync.
 *
 * What the two genuinely could share is not the store but three lower layers:
 * source-identity keying, acquisition (the brevilabs conversion call), and
 * staleness. Folding those into one reusable layer is the right future move;
 * sharing the `ProjectContextCache` singleton is not (its in-vault, RAG-shaped
 * storage doesn't fit the absolute-path/off-vault/cross-project-dedup needs here).
 */
export function cacheRoot(app: App): string {
  return path.join(copilotAppDataDir(os.homedir()), "vaults", getVaultId(app), "context-cache");
}

/** Shared snapshots for remote sources (web pages, YouTube transcripts). */
export function remotesDir(app: App): string {
  return path.join(cacheRoot(app), "remotes");
}

/** Shared snapshots for converted vault binaries (PDF, image, …), keyed by vault path. */
export function filesDir(app: App): string {
  return path.join(cacheRoot(app), "files");
}

/**
 * Per-project failure markers. Bucketed by `md5(projectId)` because snapshots
 * are shared but a failure is meaningful only to the project that hit it.
 */
export function markersDir(app: App, projectId: string): string {
  return path.join(cacheRoot(app), "markers", md5(projectId));
}

/**
 * Absolute, OS-native path of a snapshot file, derived from its source kind and
 * basename: remote kinds (web/youtube) live under {@link remotesDir}, converted
 * vault files under {@link filesDir}. The manifest lists this so the agent reads
 * the snapshot directly (the shared cache is outside every project's cwd, so an
 * absolute path is the only pointer reachable across all three backends).
 */
export function snapshotAbsPath(app: App, type: MaterializedSourceType, fileName: string): string {
  return path.join(type === "file" ? filesDir(app) : remotesDir(app), fileName);
}
