import {
  COPILOT_AGENT_BACKEND,
  COPILOT_AGENT_CREATED,
  COPILOT_AGENT_DESCRIPTION,
  COPILOT_AGENT_EFFORT,
  COPILOT_AGENT_ICON,
  COPILOT_AGENT_MEMORY,
  COPILOT_AGENT_MODEL,
  COPILOT_AGENT_NAME,
} from "@/agents/constants";
import type { CustomAgent } from "@/agents/types";
import { parseYaml, stringifyYaml } from "obsidian";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

export const AGENT_MEMORY_HEADINGS: readonly string[] = Object.freeze([
  "About the user",
  "Preferences and standing requests",
  "Ongoing threads",
  "Facts and decisions",
]);

export function buildAgentMemorySkeleton(name: string): string {
  const title = (name || "").trim() || "Agent";
  const sections = AGENT_MEMORY_HEADINGS.map((heading) => `## ${heading}\n`).join("\n");
  return `# ${title}'s memory\n\n${sections}`;
}

function readString(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

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
      frontmatter = {};
    }
  }
  const instructions = match ? content.slice(match[0].length).replace(/^\n+/, "") : content;
  const memory = frontmatter[COPILOT_AGENT_MEMORY];

  return {
    slug,
    name: readString(frontmatter, COPILOT_AGENT_NAME) || slug,
    description: readString(frontmatter, COPILOT_AGENT_DESCRIPTION),
    icon: readString(frontmatter, COPILOT_AGENT_ICON),
    backendId: readString(frontmatter, COPILOT_AGENT_BACKEND) || null,
    modelId: readString(frontmatter, COPILOT_AGENT_MODEL) || null,
    effort: readString(frontmatter, COPILOT_AGENT_EFFORT) || null,
    memoryEnabled: memory !== false && memory !== "false",
    created: readString(frontmatter, COPILOT_AGENT_CREATED),
    instructions,
  };
}

export function serializeAgentFile(agent: CustomAgent): string {
  const frontmatter: Record<string, unknown> = {
    [COPILOT_AGENT_NAME]: agent.name.trim(),
    [COPILOT_AGENT_DESCRIPTION]: agent.description.trim(),
    [COPILOT_AGENT_ICON]: agent.icon.trim(),
    [COPILOT_AGENT_BACKEND]: agent.backendId ?? "",
    [COPILOT_AGENT_MODEL]: agent.modelId ?? "",
    [COPILOT_AGENT_EFFORT]: agent.effort ?? "",
    [COPILOT_AGENT_MEMORY]: agent.memoryEnabled,
    [COPILOT_AGENT_CREATED]: agent.created,
  };
  const body = agent.instructions.replace(/^\n+/, "");
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
}
