/**
 * A user-created agent, as `agent.md` describes it.
 *
 * `slug` is the identity: it is the folder name, and the id chats and `@`
 * mentions persist. Renaming `name` therefore never moves the folder, so a
 * saved chat keeps resolving to the same agent after a rename.
 */
export interface CustomAgent {
  /** Folder name under the agents root; stable for the agent's lifetime. */
  slug: string;
  /** Display name. Free-form and renameable. */
  name: string;
  /** One-line self-description shown in the list, picker, and typeahead. */
  description: string;
  /** Single emoji or letter shown wherever the agent is named. */
  icon: string;
  /** Pinned backend id, or null to use whichever backend the session is on. */
  backendId: string | null;
  /** Pinned model id, or null to use the backend's own default. */
  modelId: string | null;
  /** When false, `MEMORY.md` is neither read nor written. */
  memoryEnabled: boolean;
  /** ISO-8601 creation timestamp, written once at create. */
  created: string;
  /** Body of `agent.md` — the persona's standing instructions. */
  instructions: string;
}

/** An agent plus where it lives, as {@link AgentFileManager} reports it. */
export interface AgentRecord {
  agent: CustomAgent;
  /** Vault-relative folder, `<agents root>/<slug>`. */
  folderPath: string;
  /** Vault-relative path of `agent.md`. */
  filePath: string;
  /** Vault-relative path of `MEMORY.md`. */
  memoryPath: string;
  /** Size of `MEMORY.md` in bytes; 0 when the file is absent. */
  memoryBytes: number;
}

/** The editable fields of an agent — everything except its derived identity. */
export type AgentDraft = Omit<CustomAgent, "slug" | "created">;

/**
 * The built-in answerer that is not an agent folder: today's anonymous
 * assistant, i.e. the product prompt plus `AGENTS.md`, with no persona body and
 * no memory. It has no files, so it can be neither edited nor deleted, and the
 * agent picker always offers it.
 *
 * See `designdocs/CUSTOM_AGENTS.md` §2 ("The default assistant is an agent too").
 */
export interface BuiltinAgentEntry {
  kind: "builtin";
  slug: string;
  name: string;
  description: string;
  icon: string;
}

/** A user-created agent as the picker sees it. */
export interface CustomAgentEntry {
  kind: "custom";
  slug: string;
  name: string;
  description: string;
  icon: string;
  agent: CustomAgent;
}

/** Everything a user can be "talking to". */
export type AgentEntry = BuiltinAgentEntry | CustomAgentEntry;

/** The slug that means "no persona" — reserved, so no folder may claim it. */
export const BUILTIN_AGENT_SLUG = "copilot";

/** The single built-in entry. Frozen: it is a constant, not per-vault state. */
export const BUILTIN_AGENT: BuiltinAgentEntry = Object.freeze({
  kind: "builtin",
  slug: BUILTIN_AGENT_SLUG,
  name: "Copilot",
  description: "The default assistant. Your vault instructions, no persona, no memory.",
  icon: "✦",
});

/** Frozen empty agent list — referential stability (see AGENTS.md). */
export const EMPTY_AGENT_RECORDS: readonly AgentRecord[] = Object.freeze([]);

/** Present a user-created agent the same way the picker presents the built-in. */
export function toAgentEntry(agent: CustomAgent): CustomAgentEntry {
  return {
    kind: "custom",
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    agent,
  };
}

/**
 * Resolve the agent a chat says it is talking to.
 *
 * A chat whose agent was deleted still has to open, so an unknown slug — and
 * the absent slug older chats carry — resolves to the built-in rather than
 * failing. See `designdocs/CUSTOM_AGENTS.md` §1 and §8.
 *
 * @param slug - Slug persisted on the chat, or null when it names no agent.
 * @param agents - Agents currently on disk.
 */
export function resolveAgentEntry(
  slug: string | null | undefined,
  agents: readonly CustomAgent[]
): AgentEntry {
  if (!slug || slug === BUILTIN_AGENT_SLUG) return BUILTIN_AGENT;
  const match = agents.find((agent) => agent.slug === slug);
  return match ? toAgentEntry(match) : BUILTIN_AGENT;
}
