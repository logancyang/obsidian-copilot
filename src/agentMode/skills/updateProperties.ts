import { logError, logWarn } from "@/logger";
import { parentDir } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";
import {
  NAME_MAX,
  NAME_RE,
  parseSkillFile,
  serializeSkillFile,
  validateName,
  type SkillFrontmatterPatch,
} from "./skillFormat";
import { removeAgentLink, replaceAgentLink } from "./symlinks";
import type { ToggleAgentFs } from "./toggleAgent";
import type { BackendId, Skill } from "./types";

export type PropertiesFs = ToggleAgentFs;

export type PropertiesFailReason = "invalid" | "collision" | "eperm";

export type PropertiesResult =
  | { ok: true }
  | { ok: false; reason: PropertiesFailReason }
  | { ok: false; reason: string };

function isValidName(name: string): boolean {
  return (
    typeof name === "string" && name.length > 0 && name.length <= NAME_MAX && NAME_RE.test(name)
  );
}

export interface UpdatePropertiesOptions {
  skill: Skill;
  patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">;
  fs: PropertiesFs;
}

export async function runUpdateProperties(
  options: UpdatePropertiesOptions
): Promise<PropertiesResult> {
  const { skill, patch, fs } = options;
  try {
    const raw = await fs.readFile(skill.filePath);
    const parsed = parseSkillFile(raw, skill.name);
    const next = serializeSkillFile(parsed, patch);
    await fs.writeFile(skill.filePath, next);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] updateProperties: failed to rewrite ${skill.filePath}`, err);
    return { ok: false, reason };
  }
}

export interface RenameSkillOptions {
  skill: Skill;
  newName: string;
  canonicalAbsRoot: string;
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  fs: PropertiesFs;
}

export interface RenameSkillSuccess {
  ok: true;
  newDirPath: string;
  newFilePath: string;
}

export interface RenameSkillFailure {
  ok: false;
  reason: string;
  mutated?: boolean;
}

export async function runRenameSkill(
  options: RenameSkillOptions
): Promise<RenameSkillSuccess | RenameSkillFailure> {
  const { skill, newName, canonicalAbsRoot, agentDirsAbs, fs } = options;

  if (newName === skill.name) {
    return { ok: true, newDirPath: skill.dirPath, newFilePath: skill.filePath };
  }

  if (!isValidName(newName)) {
    return { ok: false, reason: "invalid" };
  }

  const isProjectSkill = skill.location.kind === "project";
  const destRoot = (isProjectSkill ? parentDir(skill.dirPath) : canonicalAbsRoot).replace(
    /[/\\]+$/,
    ""
  );
  const newDirPath = `${destRoot}/${newName}`;
  const newFilePath = `${newDirPath}/SKILL.md`;

  if (await fs.exists(newDirPath)) {
    return { ok: false, reason: "collision" };
  }

  try {
    await renameWithRetry(skill.dirPath, newDirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rename ${skill.dirPath} → ${newDirPath}`, err);
    return { ok: false, reason };
  }

  let epermSeen = false;
  if (!isProjectSkill) {
    for (const agent of skill.enabledAgents) {
      const agentDir = agentDirsAbs[agent];
      if (agentDir === undefined) continue;

      try {
        await removeAgentLink(fs, agentDir, skill.name);
      } catch (err) {
        logWarn(
          `[skills] renameSkill: could not remove stale ${agent} link for ${skill.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      const linkResult = await replaceAgentLink(fs, agentDir, newName, newDirPath);
      if (!linkResult.ok) {
        logWarn(
          `[skills] renameSkill: ${agent} symlink retarget failed (${linkResult.reason}): ${linkResult.message}`
        );
        epermSeen = true;
      }
    }
  }

  try {
    const raw = await fs.readFile(newFilePath);
    const parsed = parseSkillFile(raw, skill.name);
    validateName(newName, newName);
    const next = serializeSkillFile(parsed, { name: newName });
    await fs.writeFile(newFilePath, next);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rewrite name in ${newFilePath}`, err);
    return { ok: false, reason, mutated: true };
  }

  if (epermSeen) {
    return { ok: false, reason: "eperm", mutated: true };
  }
  return { ok: true, newDirPath, newFilePath };
}
