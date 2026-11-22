import { logError, logWarn } from "@/logger";
import { joinPosix } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";
import {
  parseSkillFile,
  serializeSkillFile,
  SkillFormatError,
  type ParsedSkillFile,
} from "./skillFormat";
import { suffixOnCollision } from "./suffixOnCollision";
import { replaceAgentLink, type SymlinksFs } from "./symlinks";
import type { BackendId, Skill } from "./types";

export interface MigrateSkillFs extends SymlinksFs {
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
  mkdirRecursive(absPath: string): Promise<void>;
  list(absPath: string): Promise<string[]>;
}

export interface MigrateSkillSuccess {
  ok: true;
  resolvedName: string;
  newDirPath: string;
  newFilePath: string;
}

export interface MigrateSkillFailure {
  ok: false;
  reason: string;
  mutated?: boolean;
}

export type MigrateSkillResult = MigrateSkillSuccess | MigrateSkillFailure;

export interface MigrateProjectSkillOptions {
  sourceName: string;
  sourceDirAbs: string;
  duplicateSourceDirsAbs: ReadonlyArray<string>;
  canonicalAbsRoot: string;
  enabledAgentsAfter: ReadonlyArray<BackendId>;
  targetAgentDirsAbs: Readonly<Record<BackendId, string>>;
  preTakenNames: ReadonlyArray<string>;
  fs: MigrateSkillFs;
}

export async function migrateProjectSkill(
  options: MigrateProjectSkillOptions
): Promise<MigrateSkillResult> {
  const {
    sourceName,
    sourceDirAbs,
    duplicateSourceDirsAbs,
    canonicalAbsRoot,
    enabledAgentsAfter,
    targetAgentDirsAbs,
    preTakenNames,
    fs,
  } = options;

  const taken = new Set<string>(preTakenNames);
  let resolvedName: string;
  try {
    resolvedName = suffixOnCollision(sourceName, taken);
  } catch (err) {
    return fail(describe(err));
  }
  const newDirPath = joinPosix(canonicalAbsRoot, resolvedName);
  const newFilePath = joinPosix(newDirPath, "SKILL.md");

  try {
    await fs.mkdirRecursive(canonicalAbsRoot);
  } catch (err) {
    return fail(`Could not create canonical folder: ${describe(err)}`);
  }

  try {
    await renameWithRetry(sourceDirAbs, newDirPath);
  } catch (err) {
    return fail(`Could not move ${sourceDirAbs} → ${newDirPath}: ${describe(err)}`);
  }

  let parsed: ParsedSkillFile;
  try {
    const raw = await fs.readFile(newFilePath);
    parsed = parseSkillFile(raw, sourceName);
  } catch (err) {
    const reason =
      err instanceof SkillFormatError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after parse error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason };
  }

  let stamped: string;
  try {
    stamped = serializeSkillFile(parsed, {
      ...(resolvedName !== sourceName ? { name: resolvedName } : {}),
      enabledAgents: [...enabledAgentsAfter],
    });
  } catch (err) {
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after serialize error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason: `Could not serialize SKILL.md: ${describe(err)}` };
  }

  try {
    await fs.writeFile(newFilePath, stamped);
  } catch (err) {
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after write error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason: `Could not write SKILL.md: ${describe(err)}` };
  }

  for (const duplicateDir of duplicateSourceDirsAbs) {
    try {
      await fs.rmRecursive(duplicateDir);
    } catch (err) {
      logWarn(
        `[skills] migrateProjectSkill: could not remove duplicate ${duplicateDir}: ${describe(err)}`
      );
    }
  }

  let epermSeen = false;
  for (const agent of enabledAgentsAfter) {
    const agentDir = targetAgentDirsAbs[agent];
    if (agentDir === undefined) {
      logWarn(`[skills] migrateProjectSkill: unknown agent dir for ${agent}`);
      continue;
    }
    const slot = joinPosix(agentDir, resolvedName);
    if (await fs.exists(slot)) {
      const slotIsLink = await fs.isSymlink(slot).catch(() => false);
      if (!slotIsLink) {
        logWarn(
          `[skills] migrateProjectSkill: ${agent} slot ${slot} holds a real directory (a different skill of the same name); skipping link to avoid clobbering it`
        );
        continue;
      }
    }
    const linkResult = await replaceAgentLink(fs, agentDir, resolvedName, newDirPath);
    if (!linkResult.ok) {
      epermSeen = true;
      logWarn(
        `[skills] migrateProjectSkill: ${agent} symlink failed (${linkResult.reason}): ${linkResult.message}`
      );
    }
  }

  if (epermSeen) {
    return {
      ok: false,
      reason: "eperm",
      mutated: true,
    };
  }

  return { ok: true, resolvedName, newDirPath, newFilePath };
}

export function duplicateSourceDirsFor(
  skill: Skill,
  agentDirsAbs: Readonly<Record<BackendId, string>>
): string[] {
  if (skill.location.kind !== "project") return [];
  const repAbs = skill.dirPath;
  const dirs: string[] = [];
  for (const agent of skill.location.agentDirs) {
    const agentDirAbs = agentDirsAbs[agent];
    if (agentDirAbs === undefined) continue;
    const dupDir = joinPosix(agentDirAbs, skill.name);
    if (dupDir !== repAbs) dirs.push(dupDir);
  }
  return dirs;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(reason: string): MigrateSkillFailure {
  return { ok: false, reason };
}
