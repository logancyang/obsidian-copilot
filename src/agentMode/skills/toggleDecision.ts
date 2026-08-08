import type { BackendId, Skill } from "./types";

/**
 * Decision produced by {@link decideToggleAction}. The SkillRow uses this
 * to either fire `SkillManager.toggleAgent` directly, fire one of the
 * project-skill migration paths, or surface the migration confirm dialog
 * before committing.
 *
 *   - `no-op` — nothing to do (toggle ON of an already-enabled agent).
 *   - `canonical-toggle` — call `SkillManager.toggleAgent` (existing path).
 *   - `mirrored-remove-one` — call `SkillManager.removeProjectAgentDir` to
 *     delete one of several mirrored agent copies. No modal; surface a
 *     `Notice` after success.
 *   - `migrate-confirm` — show {@link MigrateSkillConfirmModal}; on
 *     confirm, the row calls `SkillManager.migrateProjectSkillForToggle`
 *     with the right `targetAgent` + `action` triple.
 */
export type ToggleDecision =
  | { kind: "no-op" }
  | { kind: "canonical-toggle"; enabled: boolean }
  | { kind: "mirrored-remove-one"; agent: BackendId }
  | {
      kind: "migrate-confirm";
      variant: "project-single" | "project-mirrored" | "disable-last-agent";
      /** Agent being toggled — ON for expand variants, OFF for disable-last. */
      targetAgent: BackendId;
      /** Migration action passed straight to SkillManager on confirm. */
      action: "expandToNewAgent" | "disableLastAgent";
    };

/**
 * Pure decision function: given a skill, an agent being toggled, and the
 * intended new state, return what the UI should do. No FS work; this is
 * the rulebook from §7 of the Skills Discovery Redesign expressed as
 * data so the toggle wiring stays trivially testable.
 */
export function decideToggleAction(
  skill: Skill,
  agent: BackendId,
  willBeEnabled: boolean
): ToggleDecision {
  if (skill.location.kind === "canonical") {
    return { kind: "canonical-toggle", enabled: willBeEnabled };
  }

  const { agentDirs } = skill.location;
  const isAlreadyEnabled = agentDirs.includes(agent);

  if (willBeEnabled) {
    // Toggle ON.
    if (isAlreadyEnabled) return { kind: "no-op" };
    // Need to expand the skill's reach — migrate to canonical.
    return {
      kind: "migrate-confirm",
      variant: agentDirs.length >= 2 ? "project-mirrored" : "project-single",
      targetAgent: agent,
      action: "expandToNewAgent",
    };
  }

  // Toggle OFF.
  if (!isAlreadyEnabled) return { kind: "no-op" };
  if (agentDirs.length === 1) {
    // Disabling the only agent — would orphan the SKILL.md without
    // migrating, so route through the disable-last-agent confirm.
    return {
      kind: "migrate-confirm",
      variant: "disable-last-agent",
      targetAgent: agent,
      action: "disableLastAgent",
    };
  }
  // Mirrored skill, several agents enabled — drop just this agent's
  // copy; skill stays project-managed under the others.
  return { kind: "mirrored-remove-one", agent };
}
