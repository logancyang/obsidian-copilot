import type { AgentEntry } from "@/agents/types";
import type { AgentMentionEntry } from "@/components/chat-components/hooks/useAtMentionCategories";
import { EMPTY_AGENT_MENTIONS } from "@/components/chat-components/hooks/useAtMentionCategories";

export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

export function listMentionableAgents(
  entries: readonly AgentEntry[]
): ReadonlyArray<AgentMentionEntry> {
  const agents = entries
    .filter((entry) => entry.kind === "custom")
    .map(({ slug, name, description, icon, avatarSrc }) => ({
      slug,
      name,
      description,
      icon,
      avatarSrc,
    }));
  return agents.length > 0 ? agents : EMPTY_AGENT_MENTIONS;
}
