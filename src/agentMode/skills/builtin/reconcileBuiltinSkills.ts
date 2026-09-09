import type { InstallState } from "@/agentMode/session/types";
import type {
  BuiltinPreferences,
  BuiltinPreferencesUpdate,
} from "@/settings/builtinSkillPreferences";
import type { CopilotSettings } from "@/settings/model";
import { joinPosix } from "@/utils/pathUtils";
import { ALL_MANAGED_SKILLS, planManagedBuiltins } from "./builtinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
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
  savePreferences: (update: BuiltinPreferencesUpdate) => Promise<BuiltinPreferences>;
}

/**
 * Reconcile bundled files from durable opt-outs and currently available agents.
 * Ownership and file-version handling stay with the existing seeder.
 * @param options - Current settings, agent availability, filesystem, and durable preference writer.
 */
export async function reconcileBuiltinSkills(options: ReconcileBuiltinOptions): Promise<void> {
  const { folder, fs, settings, availableAgents, registeredAgents, savePreferences } = options;
  let preferences: BuiltinPreferences = { ...settings.agentMode.skills.builtinPreferences };
  // Import file choices once before any generation. Empty records mark completed migration,
  // preventing a temporarily unavailable agent from becoming a permanent opt-out.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  let changed = false;
  const errors: string[] = [];
  for (const skill of ALL_MANAGED_SKILLS) {
    if (preferences[skill.name] !== undefined) continue;
    try {
      const legacyPreference = skill.legacyName ? preferences[skill.legacyName] : undefined;
      let disabledAgents: string[] = [];
      for (const name of [skill.name, ...(skill.legacyName ? [skill.legacyName] : [])]) {
        const state = await inspectBuiltinSkill(folder, name, fs);
        if (state === "failed") throw new Error(`Could not read built-in skill ${name}.`);
        if (state !== "seeded") continue;
        const parsed = parseSkillFile(
          await fs.read(joinPosix(joinPosix(folder, name), "SKILL.md")),
          name
        );
        disabledAgents = registeredAgents.filter(
          (agent) => !parsed.frontmatter.enabledAgents.includes(agent)
        );
        break;
      }
      preferences[skill.name] = legacyPreference ?? { disabledAgents };
      changed = true;
    } catch (error) {
      // One damaged bundled file must not block unrelated installs or opt-outs. Keep
      // its migration pending and its files untouched until it can be read safely.
      // https://github.com/logancyang/obsidian-copilot/issues/3022
      errors.push(
        `Could not migrate built-in skill ${skill.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (changed) {
    const migrated = preferences;
    preferences = await savePreferences((current) => ({ ...migrated, ...current }));
  }
  const gated = new Set(
    planManagedBuiltins({
      search: settings.enableMiyoSearchSkill === true,
      documents: settings.docProcessorBackend === "miyo",
    }).seed.map((skill) => skill.name)
  );
  const enabledAgents: Record<string, string[]> = {};
  for (const skill of ALL_MANAGED_SKILLS) {
    const pref = preferences[skill.name];
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
  const seed = ALL_MANAGED_SKILLS.filter(
    (skill) =>
      preferences[skill.name] !== undefined &&
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
    if (preferences[skill.name] === undefined || enabledAgents[skill.name].length > 0) continue;
    for (const name of [skill.name, ...(skill.legacyName ? [skill.legacyName] : [])]) {
      await removeSeededBuiltin(folder, name, fs);
      const state = await inspectBuiltinSkill(folder, name, fs);
      if (state === "seeded" || state === "failed")
        errors.push(`Could not remove disabled built-in skill ${name}.`);
    }
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
