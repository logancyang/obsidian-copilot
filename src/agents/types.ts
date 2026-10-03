export interface CustomAgent {
  slug: string;
  name: string;
  description: string;
  icon: string;
  backendId: string | null;
  modelId: string | null;
  effort: string | null;
  memoryEnabled: boolean;
  created: string;
  instructions: string;
}

export interface AgentRecord {
  agent: CustomAgent;
  folderPath: string;
  filePath: string;
  memoryPath: string;
  memoryFolderPath: string;
  memoryBytes: number;
  avatarSrc: string | null;
}

export type AgentDraft = Omit<CustomAgent, "slug" | "created">;

export interface BuiltinAgentEntry {
  kind: "builtin";
  slug: string;
  name: string;
  description: string;
  icon: string;
  avatarSrc: null;
}

export interface CustomAgentEntry {
  kind: "custom";
  slug: string;
  name: string;
  description: string;
  icon: string;
  avatarSrc: string | null;
  agent: CustomAgent;
}

export type AgentEntry = BuiltinAgentEntry | CustomAgentEntry;

export const BUILTIN_AGENT_SLUG = "copilot";

export const BUILTIN_AGENT: BuiltinAgentEntry = Object.freeze({
  kind: "builtin",
  slug: BUILTIN_AGENT_SLUG,
  name: "Copilot",
  description: "Your vault instructions, no persona, no memory.",
  icon: "✦",
  avatarSrc: null,
});

export const EMPTY_AGENT_RECORDS: readonly AgentRecord[] = Object.freeze([]);

export function toAgentEntry(
  agent: CustomAgent,
  avatarSrc: string | null = null
): CustomAgentEntry {
  return {
    kind: "custom",
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    avatarSrc,
    agent,
  };
}

export function resolveAgentEntry(
  slug: string | null | undefined,
  agents: readonly CustomAgent[]
): AgentEntry {
  if (!slug || slug === BUILTIN_AGENT_SLUG) return BUILTIN_AGENT;
  const match = agents.find((agent) => agent.slug === slug);
  return match ? toAgentEntry(match) : BUILTIN_AGENT;
}
