import {
  COPILOT_AGENT_BACKEND,
  COPILOT_AGENT_CREATED,
  COPILOT_AGENT_DESCRIPTION,
  COPILOT_AGENT_ICON,
  COPILOT_AGENT_MEMORY,
  COPILOT_AGENT_MODEL,
  COPILOT_AGENT_NAME,
} from "@/agents/constants";
import type { CustomAgent } from "@/agents/types";
import { parseYaml, stringifyYaml } from "obsidian";

/** Leading YAML frontmatter block, including its closing marker. */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

/**
 * The headings `MEMORY.md` is built with, in order.
 *
 * Fixed rather than free-form so the memory pass always has somewhere to append
 * and so a returned file that dropped them can be recognized as damaged. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Memory").
 */
export const AGENT_MEMORY_HEADINGS: readonly string[] = Object.freeze([
  "About the user",
  "Preferences and standing requests",
  "Ongoing threads",
  "Facts and decisions",
]);

/**
 * Build the empty `MEMORY.md` an agent starts life with: a title and the four
 * fixed headings, with nothing under them.
 *
 * @param name - Agent display name, used for the title line.
 */
export function buildAgentMemorySkeleton(name: string): string {
  const title = (name || "").trim() || "Agent";
  const sections = AGENT_MEMORY_HEADINGS.map((heading) => `## ${heading}\n`).join("\n");
  return `# ${title}'s memory\n\n${sections}`;
}

/**
 * Whether a string is usable as an agent icon: exactly one user-perceived
 * character. Emoji built from several code points (skin tones, ZWJ sequences,
 * flags) count as one, which is why this segments rather than counting length.
 *
 * @param icon - Raw field value, as typed.
 */
export function isValidAgentIcon(icon: string): boolean {
  const trimmed = (icon || "").trim();
  if (trimmed.length === 0) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(trimmed)].length === 1;
}

/**
 * Read a frontmatter value as a trimmed string.
 *
 * Absent, null, and non-scalar values read as empty: YAML lets a hand edit put
 * a list or a map where a line of text belongs, and an agent with a blank
 * description is a better outcome than one rendered as "[object Object]".
 */
function readString(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Parse one `agent.md` into an agent record.
 *
 * Every frontmatter key except the slug is optional, because the file is
 * user-owned: it can be hand-edited in Obsidian and Copilot never rewrites it
 * outside the editor. A file missing its keys therefore degrades to an agent
 * named after its folder rather than disappearing from the list.
 *
 * @param slug - Folder name, the agent's identity; never read from the file.
 * @param raw - Full file contents, frontmatter and body.
 */
export function parseAgentFile(slug: string, raw: string): CustomAgent {
  const withBom = raw || "";
  const content = withBom.startsWith("\uFEFF") ? withBom.slice(1) : withBom;
  const match = content.match(FRONTMATTER_BLOCK);
  let frontmatter: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = parseYaml(match[1]);
      if (parsed && typeof parsed === "object") frontmatter = parsed as Record<string, unknown>;
    } catch {
      // Malformed YAML is the user's own edit in progress. Keep the body and
      // fall back to the defaults below rather than dropping the agent.
      frontmatter = {};
    }
  }
  // Drop the blank line the serializer puts between frontmatter and body, so a
  // save/load round trip does not grow one leading newline per cycle.
  const instructions = match ? content.slice(match[0].length).replace(/^\n+/, "") : content;
  const memory = frontmatter[COPILOT_AGENT_MEMORY];

  return {
    slug,
    name: readString(frontmatter, COPILOT_AGENT_NAME) || slug,
    description: readString(frontmatter, COPILOT_AGENT_DESCRIPTION),
    icon: readString(frontmatter, COPILOT_AGENT_ICON),
    backendId: readString(frontmatter, COPILOT_AGENT_BACKEND) || null,
    modelId: readString(frontmatter, COPILOT_AGENT_MODEL) || null,
    // Memory is on unless the file says otherwise, so an agent whose key was
    // hand-deleted keeps the notebook it has already written.
    memoryEnabled: memory !== false && memory !== "false",
    created: readString(frontmatter, COPILOT_AGENT_CREATED),
    instructions,
  };
}

/**
 * Render an agent back to `agent.md`.
 *
 * Unset optional pins are emitted as empty keys rather than omitted, so the
 * file always shows the full record a user can fill in by hand.
 *
 * @param agent - Agent to serialize; its slug is carried by the folder, not the file.
 */
export function serializeAgentFile(agent: CustomAgent): string {
  const frontmatter: Record<string, unknown> = {
    [COPILOT_AGENT_NAME]: agent.name.trim(),
    [COPILOT_AGENT_DESCRIPTION]: agent.description.trim(),
    [COPILOT_AGENT_ICON]: agent.icon.trim(),
    [COPILOT_AGENT_BACKEND]: agent.backendId ?? "",
    [COPILOT_AGENT_MODEL]: agent.modelId ?? "",
    [COPILOT_AGENT_MEMORY]: agent.memoryEnabled,
    [COPILOT_AGENT_CREATED]: agent.created,
  };
  const body = agent.instructions.replace(/^\n+/, "");
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
}
