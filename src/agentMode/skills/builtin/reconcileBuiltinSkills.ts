import type { InstallState } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";
import { joinPosix } from "@/utils/pathUtils";
import {
  ALL_MANAGED_SKILLS,
  RETIRED_BUILTIN_SKILLS,
  planManagedBuiltins,
} from "@/builtinSkills/builtinSkills";
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
}

/**
 * Reconcile bundled files from durable opt-outs and currently available agents.
 * Ownership and file-version handling stay with the existing seeder.
 * @param options - Current settings, agent availability, and filesystem.
 */
export async function reconcileBuiltinSkills(options: ReconcileBuiltinOptions): Promise<void> {
  const { folder, fs, settings, availableAgents, registeredAgents } = options;
  const preferences = settings.agentMode.skills.builtinPreferences;
  const errors: string[] = [];
  // Retired skills must stop being discoverable even when no replacement or agent
  // is enabled. Keep file ownership independent of user overrides so cleanup retries.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  for (const skill of RETIRED_BUILTIN_SKILLS) {
    await removeSeededBuiltin(folder, skill.name, fs);
    const state = await inspectBuiltinSkill(folder, skill.name, fs);
    if (state === "seeded" || state === "failed")
      errors.push(`Could not remove retired built-in skill ${skill.name}.`);
  }
  const gated = new Set(
    planManagedBuiltins({
      search: settings.enableMiyoSearchSkill === true,
      documents: settings.docProcessorBackend === "miyo",
    }).seed.map((skill) => skill.name)
  );
  const enabledAgents: Record<string, string[]> = {};
  for (const skill of ALL_MANAGED_SKILLS) {
    const pref = preferences?.[skill.name];
    enabledAgents[skill.name] =
      !gated.has(skill.name) || pref?.disabled
        ? []
        : registeredAgents.filter((agent) => !pref?.disabledAgents?.includes(agent));
  }
  // No effective consumer means no canonical files, including on a fresh vault.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  // Canonical metadata is synced; device availability must only govern local installation.
  // An unavailable device retains existing canonical files so it cannot delete another
  // device's tools through sync. https://github.com/logancyang/obsidian-copilot/issues/3022
  const seed = ALL_MANAGED_SKILLS.filter((skill) =>
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
    // A seeder write can fail without rejecting; installation must report actual disk state.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    if (!supportFilesPresent)
      errors.push(
        state === "collision"
          ? `A user-owned skill occupies ${skill.name}.`
          : `Could not install built-in skill ${skill.name}.`
      );
  }
  for (const skill of ALL_MANAGED_SKILLS) {
    if (enabledAgents[skill.name].length > 0) continue;
    await removeSeededBuiltin(folder, skill.name, fs);
    const state = await inspectBuiltinSkill(folder, skill.name, fs);
    if (state === "seeded" || state === "failed")
      errors.push(`Could not remove disabled built-in skill ${skill.name}.`);
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
}

const EMPTY_AVAILABLE_AGENTS = Object.freeze([]) as unknown as string[];

/**
 * Preserve installed skill files while a known agent undergoes a compatibility recheck.
 * @param states - Current readiness for backends that support skills.
 * @param previous - Agent ids confirmed ready earlier in this plugin lifecycle.
 */
export function availableBuiltinAgents(
  states: Readonly<Record<string, InstallState>>,
  previous: readonly string[]
): string[] {
  // A transient check must not delete tools underneath an active turn; an unverified
  // first install still receives no files. https://github.com/logancyang/obsidian-copilot/issues/3022
  const available = Object.entries(states)
    .filter(
      ([id, state]) =>
        state.kind === "ready" || (state.kind === "checking" && previous.includes(id))
    )
    .map(([id]) => id);
  return available.length === 0 ? EMPTY_AVAILABLE_AGENTS : available;
}
