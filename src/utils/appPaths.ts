import * as path from "node:path";

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
