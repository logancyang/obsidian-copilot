import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { compareSemver } from "@/utils/semver";
import type { BinarySettings } from "@/agentMode/backends/shared/ManagedBinaryManager";

/**
 * Reclaims completed managed versions older than the selected installation.
 * Other vaults using reclaimed versions must restart or reinstall through Configure.
 * @param root - Directory owned by the backend's managed installer.
 * @param selected - Installation retained for this plugin lifecycle.
 * @param isInstalled - Checks whether a directory contains a completed managed installation.
 */
export async function pruneManagedRuntimes(
  root: string,
  selected: BinarySettings,
  isInstalled: (directory: string, version: string) => Promise<boolean>
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  // Custom selections and missing runtimes cannot authorize deleting the fallback.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/537
  if (selected.binarySource !== "managed" || !selected.binaryPath || !selected.binaryVersion)
    return;
  try {
    const realRoot = await fs.promises.realpath(root);
    const realSelected = await fs.promises.realpath(selected.binaryPath);
    const within = (parent: string, child: string): boolean => {
      const rel = path.relative(parent, child);
      return (
        rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
      );
    };
    if (!within(realRoot, realSelected) || (await fs.promises.lstat(root)).isSymbolicLink()) return;
    for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
      const version = /^(\d+\.\d+\.\d+(?:-r\d+)?)(?:-[0-9a-f]{8}-[0-9a-f-]{27})?$/.exec(
        entry.name
      )?.[1];
      // Equal/newer pins remain available for rollback. Unknown entries, symlinks
      // and staging trees are never ours to prune. See the issue above.
      if (!entry.isDirectory() || !version || compareSemver(version, selected.binaryVersion) >= 0)
        continue;
      const directory = path.join(root, entry.name);
      if (
        within(await fs.promises.realpath(directory), realSelected) ||
        !(await isInstalled(directory, version))
      )
        continue;
      // Startup upgrades block this vault only. Reclaiming an old runtime used
      // by another vault is an accepted tradeoff; Configure can reinstall it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/537
      await fs.promises.rm(directory, { recursive: true, force: true }).catch((error) => {
        logWarn(`[AgentMode] Could not reclaim an older runtime: ${error}`);
      });
    }
  } catch (error) {
    logWarn(`[AgentMode] Runtime cleanup deferred: ${error}`);
  }
}
