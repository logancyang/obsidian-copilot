import type { InstallState } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";
import type {
  BuiltinPreferences,
  BuiltinPreferencesUpdate,
} from "@/settings/builtinSkillPreferences";
import { joinPosix } from "@/utils/pathUtils";
import {
  BUILTIN_SKILLS,
  RETIRED_BUILTIN_SKILLS,
  isBuiltinSkillEnabledFor,
} from "@/builtinSkills/builtinSkills";
import { getBuiltinEnabledAgents } from "./builtinOwnership";
import {
  inspectBuiltinSkill,
  removeSeededBuiltin,
  seedBuiltinSkills,
  type BuiltinSeedFs,
} from "./seedBuiltinSkills";

export type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";

export interface ReconcileBuiltinOptions {
  folder: string;
  fs: BuiltinSeedFs;
  settings: CopilotSettings;
  availableAgents: readonly string[];
  registeredAgents: readonly string[];
  observedAgents: Map<string, string>;
  savePreferences(update: BuiltinPreferencesUpdate): Promise<BuiltinPreferences>;
}

async function readInstalledAgents(
  folder: string,
  name: string,
  fs: BuiltinSeedFs
): Promise<string | null> {
  const path = joinPosix(joinPosix(folder, name), "SKILL.md");
  try {
    if (!(await fs.exists(path))) return null;
    return getBuiltinEnabledAgents(await fs.read(path))?.join(", ") ?? null;
  } catch {
    return null;
  }
}

export async function reconcileBuiltinSkills(options: ReconcileBuiltinOptions): Promise<void> {
  const { folder, fs, availableAgents, registeredAgents, observedAgents } = options;
  let settings = options.settings;
  // Another device's agent choice arrives as a file change before (or without) its settings, so
  // a list that changed since this device last saw it is the user's choice, not one to undo.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/1031
  for (const skill of BUILTIN_SKILLS) {
    const observed = observedAgents.get(skill.name);
    const installed = await readInstalledAgents(folder, skill.name, fs);
    if (observed === undefined || installed === null || installed === observed) continue;
    const listed = installed.split(", ");
    const builtinPreferences = await options.savePreferences((current) => ({
      ...current,
      [skill.name]: {
        ...current[skill.name],
        disabledAgents: registeredAgents.filter((agent) => !listed.includes(agent)),
      },
    }));
    settings = {
      ...settings,
      agentMode: {
        ...settings.agentMode,
        skills: { ...settings.agentMode.skills, builtinPreferences },
      },
    };
  }
  try {
    await reconcileFiles(folder, fs, settings, availableAgents, registeredAgents);
  } finally {
    for (const skill of BUILTIN_SKILLS) {
      const installed = await readInstalledAgents(folder, skill.name, fs);
      if (installed === null) observedAgents.delete(skill.name);
      else observedAgents.set(skill.name, installed);
    }
  }
}

async function reconcileFiles(
  folder: string,
  fs: BuiltinSeedFs,
  settings: CopilotSettings,
  availableAgents: readonly string[],
  registeredAgents: readonly string[]
): Promise<void> {
  const errors: string[] = [];
  // Retired skills are removed regardless of user overrides so cleanup can retry. https://github.com/logancyang/obsidian-copilot/issues/3022
  for (const skill of RETIRED_BUILTIN_SKILLS) {
    const result = await removeSeededBuiltin(folder, skill.name, fs);
    if (result === "failed") errors.push(`Could not remove retired built-in skill ${skill.name}.`);
  }
  const enabledAgents: Record<string, string[]> = {};
  for (const skill of BUILTIN_SKILLS) {
    enabledAgents[skill.name] = registeredAgents.filter((agent) =>
      isBuiltinSkillEnabledFor(settings, skill.name, agent)
    );
  }
  // Canonical files sync between devices, so an unavailable device keeps them rather than
  // deleting another device's tools. https://github.com/logancyang/obsidian-copilot/issues/3022
  const seed = BUILTIN_SKILLS.filter((skill) =>
    enabledAgents[skill.name].some((agent) => availableAgents.includes(agent))
  );
  await seedBuiltinSkills({ skillsFolderRelPath: folder, fs, skills: seed, enabledAgents });
  for (const skill of seed) {
    const state = await inspectBuiltinSkill(folder, skill.name, fs, skill.version);
    const supportFilesPresent =
      state === "seeded" &&
      (
        await Promise.all(
          skill.files.map((file) => fs.exists(joinPosix(joinPosix(folder, skill.name), file.path)))
        )
      ).every(Boolean);
    if (!supportFilesPresent)
      errors.push(
        state === "collision"
          ? `A user-owned skill occupies ${skill.name}.`
          : `Could not install built-in skill ${skill.name}.`
      );
  }
  for (const skill of BUILTIN_SKILLS) {
    if (enabledAgents[skill.name].length > 0) continue;
    const result = await removeSeededBuiltin(folder, skill.name, fs);
    if (result === "failed") errors.push(`Could not remove disabled built-in skill ${skill.name}.`);
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
}

const EMPTY_AVAILABLE_AGENTS = Object.freeze([]) as readonly string[];

export function availableBuiltinAgents(
  states: Readonly<Record<string, InstallState>>,
  previous: readonly string[]
): readonly string[] {
  // A transient re-check must not delete tools underneath an active turn. https://github.com/logancyang/obsidian-copilot/issues/3022
  const available = Object.entries(states)
    .filter(
      ([id, state]) =>
        state.kind === "ready" || (state.kind === "checking" && previous.includes(id))
    )
    .map(([id]) => id);
  if (available.length === 0) return EMPTY_AVAILABLE_AGENTS;
  if (available.length === previous.length && available.every((id, i) => id === previous[i])) {
    return previous;
  }
  return available;
}
