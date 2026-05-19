import { withTrailingSlash } from "@/utils/pathUtils";
import type { BackendId } from "./types";

/**
 * Build the one-line spawn-time directive that steers each backend to write
 * agent-authored skills into the managed canonical folder (instead of an
 * agent-specific path like `.claude/skills/`). Composed into whatever
 * existing system-prompt / instructions surface each backend supports at
 * spawn time — see spec §Decisions captured
 * ("Spawn-time system prompt steers skill creation into the managed folder").
 *
 * The folder is templated from `agentMode.skills.folder` and must be read
 * live at spawn time so a settings change takes effect on the next session.
 * Pure leaf module — no Obsidian imports, no singletons, suitable for unit
 * testing with plain arguments.
 *
 * @param agent              Authoring agent's kebab-case backend id. The
 *                           resulting skill is pre-enabled for **only**
 *                           this agent via
 *                           `metadata.copilot-enabled-agents: "<agent>"`
 *                           — an exact single-item value, never additive,
 *                           even when adapting an existing skill that
 *                           lists multiple agents.
 * @param skillsFolder       Vault-relative POSIX path of the canonical
 *                           skills folder (e.g. `"copilot/skills"`).
 * @param agentSkillsDirs    Project-relative skills directory of every
 *                           registered backend (e.g. `.claude/skills`,
 *                           `.agents/skills`, `.opencode/skills`). Listed in
 *                           the directive so the agent knows which managed
 *                           symlink locations to avoid writing into.
 * @returns The directive string, ready to append to a system prompt /
 *          instructions field. No leading or trailing newlines.
 */
export function buildSkillCreationDirective(
  agent: BackendId,
  skillsFolder: string,
  agentSkillsDirs: readonly string[]
): string {
  const managedList = agentSkillsDirs.map((d) => `\`${withTrailingSlash(d)}\``).join(", ");
  return (
    `When the user asks you to create a skill, write\n` +
    `<vault>/${skillsFolder}/<name>/SKILL.md with valid Agent\n` +
    `Skills spec frontmatter — required fields: \`name\`, \`description\`,\n` +
    `and \`metadata.copilot-enabled-agents: "${agent}"\`.\n` +
    `\n` +
    `The \`metadata.copilot-enabled-agents\` value MUST be exactly\n` +
    `"${agent}" — only the agent creating the skill, and nothing else.\n` +
    `Do not add other agents. If you are copying or adapting an existing\n` +
    `skill, overwrite this field with "${agent}"; do not preserve the\n` +
    `prior value, even if the source skill lists multiple agents.\n` +
    `Enabling additional agents is a user action performed later in the\n` +
    `Skills tab.\n` +
    `\n` +
    `Do not write into ${managedList} —\n` +
    `those are symlink locations managed by Copilot; the symlink for\n` +
    `this agent will be created automatically on the next Skills-tab\n` +
    `reconciliation.`
  );
}
