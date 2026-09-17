import type { AgentFileManager } from "@/agents/AgentFileManager";
import { formatMissingAgentLabel } from "@/agents/agentDisplay";
import { BUILTIN_AGENT, type CustomAgent } from "@/agents/types";
import { buildAgentPersonaBlocks } from "@/agentMode/session/promptEnvelope";
import { logWarn } from "@/logger";

/**
 * Who one chat is talking to, resolved once and carried by the session.
 *
 * Three things ride together because they are decided at the same moment and
 * must not drift apart: what the chat persists (`slug`), what its tab and
 * recent-list row say (`name`, `icon`), and what its first user message carries
 * (`personaBlock`). See `designdocs/CUSTOM_AGENTS.md` §3 and §4.
 */
export interface SessionAgent {
  /** Slug to persist, or null for the built-in Copilot, which persists nothing. */
  slug: string | null;
  /** Display name for the tab, the picker trigger, and the recent-list row. */
  name: string;
  /** The agent's emoji. Empty when the agent set none, or when it is gone. */
  icon: string;
  /** Rendered persona + memory blocks for the first user message; null for Copilot. */
  personaBlock: string | null;
}

/**
 * The default answerer: today's assistant, product prompt plus `AGENTS.md`, no
 * persona and no memory. Frozen — it is a constant, not per-vault state.
 */
export const COPILOT_SESSION_AGENT: SessionAgent = Object.freeze({
  slug: null,
  name: BUILTIN_AGENT.name,
  icon: BUILTIN_AGENT.icon,
  personaBlock: null,
});

/**
 * Resolve a custom agent into the form a session holds, reading its memory file
 * when the agent's memory toggle is on.
 *
 * Memory is read here, at the moment the chat is bound to the agent, rather
 * than per turn: the blocks ride the first user message only, so a later read
 * would have nowhere to go.
 *
 * @param files - Reader for the agent folder.
 * @param agent - The agent the chat is being bound to.
 */
export async function loadSessionAgent(
  files: AgentFileManager,
  agent: CustomAgent
): Promise<SessionAgent> {
  let memory: { text: string; modifiedAtMs: number } | null = null;
  if (agent.memoryEnabled) {
    try {
      memory = await files.readMemoryDocument(agent.slug);
    } catch (error) {
      // An unreadable memory file must not stop the user talking to the agent;
      // it answers in character with nothing recalled.
      logWarn(`[Agents] Could not read memory for "${agent.slug}"`, error);
    }
  }
  return {
    slug: agent.slug,
    name: agent.name,
    icon: agent.icon,
    personaBlock: buildAgentPersonaBlocks({
      name: agent.name,
      instructions: agent.instructions,
      memory,
    }),
  };
}

/**
 * The stand-in for a chat whose agent has been deleted: the name stays, so the
 * user can see who the conversation was held with, but nothing is sent and the
 * chat runs as the default assistant. See `designdocs/CUSTOM_AGENTS.md` §1.
 *
 * @param slug - Slug the chat persisted, which no longer resolves to a folder.
 */
export function missingSessionAgent(slug: string): SessionAgent {
  return { slug, name: formatMissingAgentLabel(slug), icon: "", personaBlock: null };
}
