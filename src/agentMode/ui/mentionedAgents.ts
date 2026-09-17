import type { AgentEntry } from "@/agents/types";
import type { AgentMentionEntry } from "@/components/chat-components/hooks/useAtMentionCategories";
import { EMPTY_AGENT_MENTIONS } from "@/components/chat-components/hooks/useAtMentionCategories";

// Fan-out routing lives in session/fanout so the session layer can share it
// without depending on the UI. Re-exported here for the composer.
export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

/**
 * Project the talking-to roster into the agents the composer can `@`-mention:
 * every custom agent, never the built-in Copilot, which is who the chat is
 * already talking to and so answers without being addressed
 * (`designdocs/CUSTOM_AGENTS.md` §6).
 *
 * @param entries - The roster as the manager last read it, Copilot included.
 */
export function listMentionableAgents(
  entries: readonly AgentEntry[]
): ReadonlyArray<AgentMentionEntry> {
  const agents = entries
    .filter((entry) => entry.kind === "custom")
    .map(({ slug, name, description, icon }) => ({ slug, name, description, icon }));
  return agents.length > 0 ? agents : EMPTY_AGENT_MENTIONS;
}
