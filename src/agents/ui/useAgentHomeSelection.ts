import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { logError } from "@/logger";
import { err2String } from "@/errorFormat";
import { getSettings, setSettings, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

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

export function agentComposerHint(agent: CustomAgent | null): string | undefined {
  return agent ? `Ask ${agent.name} anything • @ to add context • / for commands` : undefined;
}

// Faces read the agent list wherever they show, so a new face alone does not rebuild a new chat and drop the model picked for it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/940
function builtFromKey(agent: CustomAgent): string {
  return JSON.stringify({ ...agent, faceSrc: undefined });
}

function rememberLastAgent(slug: string | null): void {
  if ((getSettings().agentMode.lastTeammate ?? null) === slug) return;
  setSettings((cur) => ({ agentMode: { ...cur.agentMode, lastTeammate: slug ?? undefined } }));
}

export function useAgentHomeSelection(
  store: CustomAgentStore | undefined,
  { sessionId, chatInputId, agentSlug, isLanding }: AgentHomeChat,
  switchAgent: (agent: CustomAgent | null) => Promise<void>,
  needsSetup: Pick<ReadonlySet<string>, "has">
): AgentHomeSelection {
  const gate = useCustomAgentsGate();
  const agents = useCustomAgents(store);
  const lastAgent = useSettingsValue().agentMode.lastTeammate ?? null;
  const [pending, setPending] = useState<{ chatInputId: string; slug: string | null } | null>(null);
  const chosenChatInputIds = useRef(new Set<string>());
  const droppedAgents = useRef(new Set<string>());
  const latestRequest = useRef<object | null>(null);
  const builtFrom = useRef(new Map<string, { slug: string; agent: string }>());

  const select = useCallback(
    (slug: string | null) => {
      chosenChatInputIds.current.add(chatInputId);
      const switchTo = (agent: CustomAgent | null): Promise<void> => {
        const request = { chatInputId, slug: agent?.slug ?? null };
        latestRequest.current = request;
        if (agent)
          builtFrom.current.set(chatInputId, { slug: agent.slug, agent: builtFromKey(agent) });
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
      // An agent created a moment ago is in the store before this hook re-renders with it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
      return switchTo(store?.getAgents().find((candidate) => candidate.slug === slug) ?? null);
    },
    [store, chatInputId, switchAgent]
  );

  // A new Copilot chat opens on the agent of the last chat started; until the store lists that agent, it stays on Copilot.
  // A new chat started with an agent, as by the start-a-chat command, keeps that agent.
  // A new chat whose agent's folder is deleted before its first message goes back to Copilot.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
  useEffect(() => {
    if (!isLanding) return;
    // A new chat that started on an agent before the license check locked custom agents goes back to Copilot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
    // A new chat on an agent whose model stopped running on this device goes back to Copilot the same way.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/962
    if ((gate === "locked" || needsSetup.has(agentSlug ?? "")) && agentSlug !== null) {
      void select(null);
      return;
    }
    if (gate !== "full") return;
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
    if (agentSlug === null && lastAgent !== null && !needsSetup.has(lastAgent)) {
      void select(lastAgent);
    }
  }, [gate, isLanding, chatInputId, agentSlug, lastAgent, agents, needsSetup, select]);

  // A new chat reads its agent when it is built, so an agent changed before the first message, as from its profile, rebuilds the chat to start as the agent now is.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  useEffect(() => {
    const agent = agents.find((candidate) => candidate.slug === agentSlug);
    if (!isLanding || gate !== "full" || !agent) return;
    const built = builtFrom.current.get(chatInputId);
    if (built?.slug !== agent.slug) {
      builtFrom.current.set(chatInputId, { slug: agent.slug, agent: builtFromKey(agent) });
    } else if (built.agent !== builtFromKey(agent)) {
      void select(agent.slug);
    }
  }, [gate, isLanding, chatInputId, agentSlug, agents, select]);

  const previousChat = useRef<{ sessionId: string; isLanding: boolean } | null>(null);
  useEffect(() => {
    const previous = previousChat.current;
    previousChat.current = { sessionId, isLanding };
    if (gate !== "full" || isLanding) return;
    if (previous?.sessionId === sessionId && previous.isLanding) rememberLastAgent(agentSlug);
  }, [gate, sessionId, isLanding, agentSlug]);

  // A message sent while a picked agent's chat is still starting stays on the chat that received it, so the bar names that chat's agent.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/938
  const shownSlug = isLanding && pending?.chatInputId === chatInputId ? pending.slug : agentSlug;
  const selected = agents.find((agent) => agent.slug === shownSlug) ?? null;
  return { agents, selected, select, switching: pending?.chatInputId === chatInputId };
}
