import { FileSystemAdapter, type App } from "obsidian";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

import { joinPosix } from "@/utils/pathUtils";

import { MIYO_SEARCH_SKILL } from "@/builtinSkills/builtinSkills";
import {
  type BuiltinSeedFs,
  inspectBuiltinSkill,
  removeSeededBuiltin,
  seedBuiltinSkills,
} from "./seedBuiltinSkills";

/**
 * Shared seed/remove surface for the user-installable `miyo-search` skill.
 *
 * Both the background settings watcher (`agentMode/index.ts`) and the settings
 * UI must seed/prune the same skill through the same vault-adapter FS, so that
 * logic lives here once. Node access is deferred and desktop-guarded so this
 * module can be imported directly. The agent-mode barrel pulls in Node and
 * would break the mobile bundle.
 */

/** Outcome of an install attempt, read back from disk after the seed pass. */
export type MiyoSearchInstallResult = "installed" | "collision" | "failed";
/** Outcome of a remove attempt. `collision` = a markerless user copy was kept. */
export type MiyoSearchRemoveResult = "removed" | "collision" | "failed";

/**
 * Adapt the vault's file adapter to the seeder's minimal write surface. Same
 * shape the agent-mode host builds inline; centralized so callers don't each
 * re-wrap the adapter.
 */
export function buildBuiltinSeedFs(app: App): BuiltinSeedFs {
  const adapter = app.vault.adapter;
  return {
    exists: (p) => adapter.exists(p),
    read: (p) => adapter.read(p),
    write: (p, c) => adapter.write(p, c),
    mkdir: (p) => adapter.mkdir(p),
    removeDir: async (p) => {
      // A linked canonical directory belongs to its target; unlink it without
      // walking into external files. https://github.com/logancyang/obsidian-copilot/issues/3022
      if (adapter instanceof FileSystemAdapter && isDesktopRuntime()) {
        const fs = requireNodeModule<typeof import("node:fs")>("fs");
        if ((await fs.promises.lstat(adapter.getFullPath(p))).isSymbolicLink()) {
          await adapter.rmdir(p, true);
          return;
        }
      }
      // Recursive deletion can remove SKILL.md before hitting an unreadable child.
      // Keep ownership evidence until every child is gone so retries remain safe.
      // https://github.com/logancyang/obsidian-copilot/issues/3022
      const contents = await adapter.list(p);
      for (const folder of contents.folders) await adapter.rmdir(folder, true);
      for (const file of contents.files) {
        if (file !== joinPosix(p, "SKILL.md")) await adapter.remove(file);
      }
      await adapter.rmdir(p, true);
    },
  };
}

/**
 * Seed the `miyo-search` skill into `folder`, then report the disk truth so the
 * caller can surface an accurate result:
 * - `"installed"` — our marked copy AND all its support scripts are on disk,
 *   whether freshly written or already current.
 * - `"collision"` — a user-authored `miyo-search` dir already exists (no marker);
 *   the seeder leaves it untouched, so we neither claim success nor clobber it.
 * - `"failed"` — nothing on disk afterward, or a support file is missing (a
 *   partial/failed write the seeder swallowed), or it couldn't be read.
 *
 * Reads state back from disk (not the seed return value) because "did the user's
 * install actually take" is a property of the files, not of the write call — a
 * current or collided skill both return an empty `seeded[]`. The marker alone
 * isn't enough: a stale marked SKILL.md whose script re-write just failed would
 * otherwise read as success, so we also verify every declared file landed.
 */
export async function installMiyoSearchSkill(
  app: App,
  folder: string
): Promise<MiyoSearchInstallResult> {
  const fs = buildBuiltinSeedFs(app);
  try {
    await seedBuiltinSkills({ skillsFolderRelPath: folder, fs, skills: [MIYO_SEARCH_SKILL] });
  } catch {
    return "failed";
  }
  // Pass the shipped version so a marker left behind by a failed upgrade (old
  // marker + old scripts, the new write swallowed by the seeder) reads as `stale`
  // → failed, not a false success.
  const state = await inspectBuiltinSkill(
    folder,
    MIYO_SEARCH_SKILL.name,
    fs,
    MIYO_SEARCH_SKILL.version
  );
  if (state === "collision") return "collision";
  if (state !== "seeded") return "failed";
  // Marker present, but confirm the wrappers the skill advertises are actually
  // on disk — otherwise the agent would run a skill whose script is missing.
  const dir = joinPosix(folder, MIYO_SEARCH_SKILL.name);
  try {
    const present = await Promise.all(
      MIYO_SEARCH_SKILL.files.map((f) => fs.exists(joinPosix(dir, f.path)))
    );
    return present.every(Boolean) ? "installed" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Remove the managed copy without treating a partial deletion as success.
 * @param app - Vault whose file adapter performs the removal.
 * @param folder - Canonical skills root relative to the vault.
 */
export async function removeMiyoSearchSkill(
  app: App,
  folder: string
): Promise<MiyoSearchRemoveResult> {
  const result = await removeSeededBuiltin(folder, MIYO_SEARCH_SKILL.name, buildBuiltinSeedFs(app));
  return result === "absent" ? "removed" : result;
}
