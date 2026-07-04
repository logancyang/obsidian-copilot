import { type App, FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { md5 } from "@/utils/hash";

/**
 * Name of Copilot's per-user, OS-level data directory: `~/.obsidian-copilot`.
 *
 * This is the single source of truth for our home-directory namespace. We
 * deliberately use a dotted, `obsidian-`-prefixed name rather than `~/.copilot`
 * (which collides with the GitHub Copilot CLI) and rather than OS-native
 * app-data dirs, to match the convention of the CLI runtimes we manage and sit
 * beside (`~/.opencode`, `~/.miyo`, `~/.codex`, `~/.claude`).
 *
 * Anything Copilot installs at the OS level (managed runtimes, caches) must
 * live under {@link copilotAppDataDir} so the namespace is defined exactly
 * once. Note: this dir is shared across every vault under the same OS account,
 * so consumers must treat it as shared and never perform per-vault destructive
 * operations on sibling entries.
 */
export const COPILOT_APP_DIR_NAME = ".obsidian-copilot";

/**
 * Absolute path to Copilot's OS-level data root for the given home directory.
 * Pure (takes `homeDir`) so it's trivially testable; callers pass
 * `os.homedir()`.
 */
export function copilotAppDataDir(homeDir: string): string {
  return path.join(homeDir, COPILOT_APP_DIR_NAME);
}

/**
 * Stable per-vault identifier used to bucket this vault's off-vault data under
 * {@link copilotAppDataDir} (e.g. `vaults/<vaultId>/`). It is the first 8 hex
 * chars of `md5(vaultBasePath)` — short enough for a readable directory name,
 * wide enough to avoid collisions across a user's handful of vaults.
 *
 * Reason: only the desktop {@link FileSystemAdapter} exposes an absolute base
 * path. On other adapters (mobile, in-memory) there is no stable path to hash,
 * so we fall back to `"default"`. Off-vault data is desktop-only anyway, so the
 * fallback is never the live path in practice — it just keeps the function
 * total. Identical input path → identical id, so every consumer that derives a
 * path from this id (recent-chats index, conversion cache) agrees.
 */
export function getVaultId(app: App): string {
  const adapter = app.vault.adapter;
  const vaultBasePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  return vaultBasePath ? md5(vaultBasePath).slice(0, 8) : "default";
}
