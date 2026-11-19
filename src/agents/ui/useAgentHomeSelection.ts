import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { logError } from "@/logger";
import { err2String } from "@/errorFormat";
import { getSettings, setSettings, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface AgentHomeChat {
  sessionId: string;
  chatInputId: string;
  agentSlug: string | null;
  isLanding: boolean;
}

export interface AgentHomeSelection {
  agents: readonly CustomAgent[];
  selected: CustomAgent | null;
  select: (slug: string | null) => Promise<void>;
  switching: boolean;
}

const NO_AGENTS: readonly CustomAgent[] = Object.freeze([]);
const NO_STORE = { subscribe: () => () => {}, getAgents: () => NO_AGENTS };

export function agentComposerHint(agent: CustomAgent | null): string | undefined {
  return agent ? `Ask ${agent.name} anything • @ to add context • / for commands` : undefined;
}

function rememberLastAgent(slug: string | null): void {
  if ((getSettings().agentMode.lastCustomAgent ?? null) === slug) return;
  setSettings((cur) => ({ agentMode: { ...cur.agentMode, lastCustomAgent: slug ?? undefined } }));
}

export function useAgentHomeSelection(
  store: CustomAgentStore | undefined,
  { sessionId, chatInputId, agentSlug, isLanding }: AgentHomeChat,
  switchAgent: (agent: CustomAgent | null) => Promise<void>
): AgentHomeSelection {
  const gate = useCustomAgentsGate();
  const source = store ?? NO_STORE;
  const listed = useSyncExternalStore(source.subscribe, source.getAgents);
  const agents = gate === "full" ? listed : NO_AGENTS;
  const lastAgent = useSettingsValue().agentMode.lastCustomAgent ?? null;
  const [pending, setPending] = useState<{ chatInputId: string; slug: string | null } | null>(null);
  const chosenChatInputIds = useRef(new Set<string>());
  const droppedAgents = useRef(new Set<string>());
  const latestRequest = useRef<object | null>(null);

  const select = useCallback(
    (slug: string | null) => {
      chosenChatInputIds.current.add(chatInputId);
      const switchTo = (agent: CustomAgent | null): Promise<void> => {
        const request = { chatInputId, slug: agent?.slug ?? null };
        latestRequest.current = request;
        setPending(request);
        return switchAgent(agent)
          .catch((error: unknown) => {
            logError("[CustomAgents] switching the new chat's agent failed", error);
            new Notice(
              `Couldn't start a chat with ${agent?.name ?? "Copilot"}. ${err2String(error)}`
            );
            // A picked agent whose chat cannot start here, as on a Codex or OpenCode that refuses custom agents, leaves the new chat on Copilot.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
            if (agent && latestRequest.current === request) return switchTo(null);
          })
          .finally(() => setPending((current) => (current === request ? null : current)));
      };
      return switchTo(agents.find((candidate) => candidate.slug === slug) ?? null);
    },
    [agents, chatInputId, switchAgent]
  );

  // A new Copilot chat opens on the agent of the last chat started; until the store lists that agent, it stays on Copilot.
  // A new chat started with an agent, as by the start-a-chat command, keeps that agent.
  // A new chat whose agent's folder is deleted before its first message goes back to Copilot.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
  useEffect(() => {
    if (gate !== "full" || !isLanding) return;
    const isListed = (slug: string | null) => slug === null || agents.some((a) => a.slug === slug);
    if (!isListed(agentSlug)) {
      const dropped = `${chatInputId}\n${agentSlug}`;
      if (droppedAgents.current.has(dropped)) return;
      droppedAgents.current.add(dropped);
      void select(null);
      return;
    }
    if (chosenChatInputIds.current.has(chatInputId) || !isListed(lastAgent)) return;
    chosenChatInputIds.current.add(chatInputId);
    if (agentSlug === null && lastAgent !== null) void select(lastAgent);
  }, [gate, isLanding, chatInputId, agentSlug, lastAgent, agents, select]);

  const previousChat = useRef<{ sessionId: string; isLanding: boolean } | null>(null);
  useEffect(() => {
    const previous = previousChat.current;
    previousChat.current = { sessionId, isLanding };
    if (gate !== "full" || isLanding) return;
    if (previous?.sessionId === sessionId && previous.isLanding) rememberLastAgent(agentSlug);
  }, [gate, sessionId, isLanding, agentSlug]);

  const shownSlug = pending?.chatInputId === chatInputId ? pending.slug : agentSlug;
  const selected = agents.find((agent) => agent.slug === shownSlug) ?? null;
  return { agents, selected, select, switching: pending?.chatInputId === chatInputId };
}
