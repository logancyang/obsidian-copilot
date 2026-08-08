import type { App } from "obsidian";

import { joinPosix } from "@/utils/pathUtils";

import { MIYO_SEARCH_SKILL } from "./builtinSkills";
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
 * logic lives here once. Deliberately node-free (only `app.vault.adapter` +
 * pure string ops) so it can be imported directly — NOT via the agent-mode
 * barrel, which pulls in Node and would break the mobile bundle.
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
    rmRecursive: (p) => adapter.rmdir(p, true),
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
 * Remove the seeded `miyo-search` copy. Reports what really happened by checking
 * disk afterward, because {@link removeSeededBuiltin} swallows its errors and
 * returns `false` both when it deliberately kept a file and when a delete threw:
 * - `"removed"`   — nothing is left at the path (deleted, or already absent).
 * - `"collision"` — a markerless (user-authored) dir was kept by the guard.
 * - `"failed"`    — our marked copy is still on disk (the delete didn't take).
 */
export async function removeMiyoSearchSkill(
  app: App,
  folder: string
): Promise<MiyoSearchRemoveResult> {
  const fs = buildBuiltinSeedFs(app);
  if (await removeSeededBuiltin(folder, MIYO_SEARCH_SKILL.name, fs)) return "removed";
  // Not removed by the helper — classify from disk rather than assuming success.
  switch (await inspectBuiltinSkill(folder, MIYO_SEARCH_SKILL.name, fs)) {
    case "absent":
      return "removed";
    case "collision":
      return "collision";
    default:
      // Still `"seeded"` (a swallowed delete error) or `"failed"` to read — the
      // skill is effectively still there, so don't claim a clean removal.
      return "failed";
  }
}
