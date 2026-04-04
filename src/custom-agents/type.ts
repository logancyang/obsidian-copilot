/**
 * Custom Agent definition.
 * Agents are user-defined AI personas with specific instructions, tool access, and model preferences.
 * Stored as markdown files with YAML frontmatter in the agents folder.
 *
 * Example file (copilot/agents/Research Assistant.md):
 * ```
 * ---
 * copilot-agent-description: "Helps research topics using vault notes and web search"
 * copilot-agent-icon: "search"
 * copilot-agent-model-key: "claude-sonnet-4-20250514|anthropic"
 * copilot-agent-tools: ["localSearch", "webSearch", "readNote"]
 * copilot-agent-enabled: true
 * copilot-agent-order: 10
 * copilot-agent-created: 1704067200000
 * copilot-agent-modified: 1704067200000
 * copilot-agent-last-used: 0
 * ---
 * You are a research assistant. When the user asks about a topic:
 * 1. First search the vault for existing notes on the topic
 * 2. If needed, search the web for additional information
 * 3. Synthesize findings into a clear, well-organized response
 * 4. Always cite sources using [[Note Title]] for vault notes
 * ```
 */
export interface CustomAgent {
  /** Agent name (derived from filename without .md) */
  title: string;

  /** Agent behavior instructions (markdown body, used as system prompt override) */
  content: string;

  /** Short description shown in the UI */
  description: string;

  /** Lucide icon name for display (e.g. "search", "pen-tool", "brain") */
  icon: string;

  /** Optional model override (e.g. "claude-sonnet-4-20250514|anthropic") */
  modelKey: string;

  /** List of tool IDs this agent can use. Empty = all tools available. */
  tools: string[];

  /** Whether the agent is enabled and visible */
  enabled: boolean;

  /** Display order */
  order: number;

  /** Timestamp when the agent was created */
  createdMs: number;

  /** Timestamp when the agent was last modified */
  modifiedMs: number;

  /** Timestamp of last use */
  lastUsedMs: number;
}

/** Frontmatter keys for custom agent files */
export const AGENT_FRONTMATTER_KEYS = {
  DESCRIPTION: "copilot-agent-description",
  ICON: "copilot-agent-icon",
  MODEL_KEY: "copilot-agent-model-key",
  TOOLS: "copilot-agent-tools",
  ENABLED: "copilot-agent-enabled",
  ORDER: "copilot-agent-order",
  CREATED: "copilot-agent-created",
  MODIFIED: "copilot-agent-modified",
  LAST_USED: "copilot-agent-last-used",
} as const;
