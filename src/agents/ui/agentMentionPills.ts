import type { CustomAgent } from "@/agents/CustomAgentStore";
import { useChatAgents } from "@/agents/ui/chatAgents";
import {
  MENTION_PILL_CLASS,
  renderMentionPills,
} from "@/components/chat-components/renderFolderMentions";
import { useCallback } from "react";

const PILL_FACE_CLASS = "tw-size-3.5 tw-shrink-0 tw-rounded-full tw-bg-primary tw-object-cover";

// The Markdown renderer leaves an @-mention as plain text, so the sent message draws each mentioned agent as a pill with its face.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function renderAgentMentions(
  container: HTMLElement,
  mentioned: readonly { name: string; agent: CustomAgent }[]
): void {
  const byMention = new Map(mentioned.map(({ name, agent }) => [`@${name}`, agent]));
  renderMentionPills(container, [...byMention.keys()], (doc, mention) => {
    const agent = byMention.get(mention);
    const pill = doc.win.createSpan({ cls: MENTION_PILL_CLASS });
    if (agent)
      pill.createEl("img", { cls: PILL_FACE_CLASS, attr: { src: agent.faceSrc, alt: "" } });
    pill.append(agent?.name ?? mention);
    return pill;
  });
}

export function useAgentMentionRenderer(
  names: readonly string[] | undefined
): (container: HTMLElement) => void {
  const agents = useChatAgents();
  return useCallback(
    (container: HTMLElement) =>
      renderAgentMentions(
        container,
        (names ?? []).flatMap((name) => {
          const agent = agents.find((candidate) => candidate.name === name);
          return agent ? [{ name, agent }] : [];
        })
      ),
    [names, agents]
  );
}
