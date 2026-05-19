import type { BackendId, Skill } from "@/agentMode";
import type { CustomCommand } from "@/commands/type";

/**
 * Discriminated union representing a single slash-menu entry. Both kinds
 * render with the same row layout (a leading pill + name + description);
 * `kind` decides how the entry dispatches on Enter.
 */
export type SlashMenuItem =
  | {
      kind: "skill";
      /** Stable key for React + fuzzysort. */
      key: string;
      /** Spec-validated skill name (used as the trigger name in the bubble). */
      name: string;
      /** Skill description (from SKILL.md frontmatter). */
      description: string;
      /** SKILL.md body, used by the plain-LLM fallback. */
      body: string;
      /** Original skill, kept for callers that need anything else. */
      skill: Skill;
    }
  | {
      kind: "command";
      key: string;
      name: string;
      /** Display subtitle; commands don't ship a description, leave empty. */
      description: string;
      /** Command body (sent to the agent at runtime or to plain LLM). */
      body: string;
      command: CustomCommand;
    };

/**
 * Build the canonical merged slash-menu list. Pure function: no React, no
 * settings reads, no disk reads — easy to unit-test the filter rules.
 *
 * Rules:
 * - When an `activeBackend` is provided, managed skills are filtered to
 *   those whose `enabledAgents` includes that backend. When `null`, the
 *   per-backend filter is bypassed (plain-LLM fallback path) and every
 *   discovered skill surfaces.
 * - Skills with `userInvocable === false` are always hidden.
 * - Legacy commands shadowed by a same-name visible skill are hidden
 *   from the slash menu (managed skill wins).
 * - Order: skills first, then commands. Within each group, the inputs
 *   keep whatever order the caller supplied (callers typically sort
 *   commands via `sortSlashCommands`).
 */
export function composeSlashMenuItems(
  skills: Skill[],
  commands: CustomCommand[],
  activeBackend: BackendId | null
): SlashMenuItem[] {
  const visibleSkills = skills.filter((skill) => {
    if (skill.userInvocable === false) return false;
    if (activeBackend === null) return true;
    return skill.enabledAgents.includes(activeBackend);
  });

  const skillNames = new Set(visibleSkills.map((s) => s.name.toLowerCase()));

  const visibleCommands = commands.filter((cmd) => {
    if (!cmd.showInSlashMenu) return false;
    return !skillNames.has(cmd.title.toLowerCase());
  });

  return [
    ...visibleSkills.map<SlashMenuItem>((skill, index) => ({
      kind: "skill",
      key: `skill:${skill.name}:${index}`,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      skill,
    })),
    ...visibleCommands.map<SlashMenuItem>((command, index) => ({
      kind: "command",
      key: `command:${command.title}:${index}`,
      name: command.title,
      description: "",
      body: command.content,
      command,
    })),
  ];
}
