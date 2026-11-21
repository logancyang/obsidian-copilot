import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { restoreAgentMentions, type AgentMention } from "@/agents/agentMentions";
import { agentToolCall } from "@/agents/agentMode/agentToolCalls";
import { readAgentReply, type AgentReply, type AgentReplyMarker } from "@/agents/agentReply";
import type { RunRef } from "@/agents/ui/chatAgents";
import { USER_SENDER } from "@/constants";

export interface RelayRun {
  relay: AgentReply;
  run: AgentMention | undefined;
}

const parsed = new WeakMap<AgentChatMessage, AgentReply | null>();

function relayOf(message: AgentChatMessage): AgentReply | null {
  if (message.sender !== USER_SENDER) return null;
  if (!parsed.has(message)) parsed.set(message, readAgentReply(message.message));
  return parsed.get(message) ?? null;
}

// A relayed reply is read from the plugin's marker on the message, never from an agent's own reply, and drawn from the run saved on the message that asked.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function relayRuns(messages: readonly AgentChatMessage[]): ReadonlyMap<string, RelayRun> {
  const runs = new Map<string, AgentMention>();
  for (const message of messages) {
    for (const mention of message.agentMentions ?? []) runs.set(mention.id, mention);
  }
  const relays = new Map<string, RelayRun>();
  for (const message of messages) {
    const relay = relayOf(message);
    if (relay) relays.set(message.id, { relay, run: runs.get(relay.marker.mention) });
  }
  return relays;
}

// A saved ask_teammate call doesn't name the run it started, so its card finds the run its agent has on the nearest message at or before the call: an ask saves its run on the last message before it, and a message to an agent already working goes to that run.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/967
export function findRun(
  messages: readonly AgentChatMessage[],
  ref: RunRef
): AgentMention | undefined {
  if ("runId" in ref) {
    return messages.flatMap((m) => m.agentMentions ?? []).find((run) => run.id === ref.runId);
  }
  const at = messages.findIndex((m) =>
    m.parts?.some((part) => part.kind === "tool_call" && part.id === ref.callId)
  );
  for (let i = at; i >= 0; i--) {
    const run = messages[i].agentMentions?.find((mention) => mention.agent === ref.agent);
    if (run) return run;
  }
  return undefined;
}

// A chat without a note loses its runs on a restart, while its agent's history keeps each relay, so a reopened chat rebuilds every run it lacks from its last relay, on the message before the run's first ask as the ask saved it, and validated as a note's run is.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/976
export function restoreRelayedRuns(
  chat: Pick<AgentSession, "getDisplayMessages" | "setAgentMentions">
): void {
  const messages = chat.getDisplayMessages();
  const known = new Set(messages.flatMap((m) => m.agentMentions ?? []).map((run) => run.id));
  const asking = new Map<string, AgentChatMessage>();
  const relayed = new Map<string, { at: AgentChatMessage; marker: AgentReplyMarker }>();
  let lastUser: AgentChatMessage | undefined;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const call = part.kind === "tool_call" ? agentToolCall(part) : null;
      const asked = call?.tool === ASK_AGENT_TOOL_NAME ? call.agent?.toLowerCase() : undefined;
      if (asked && lastUser && !asking.has(asked)) asking.set(asked, lastUser);
    }
    const marker = relayOf(message)?.marker;
    if (message.sender === USER_SENDER) lastUser = message;
    if (!marker) continue;
    const names = [marker.name.toLowerCase(), marker.agent];
    const at = relayed.get(marker.mention)?.at ?? names.map((n) => asking.get(n)).find(Boolean);
    names.forEach((n) => asking.delete(n));
    // A relay whose ask the chat doesn't hold, as one carried from the chat it continues, has no message to put its run on.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/976
    if (at && !known.has(marker.mention)) relayed.set(marker.mention, { at, marker });
  }
  const runs = new Map<AgentChatMessage, AgentMention[]>();
  for (const { at, marker } of relayed.values()) {
    const [run] = restoreAgentMentions([
      {
        id: marker.mention,
        agent: marker.agent,
        name: marker.name,
        status: marker.status,
        // A replay can carry no send times, and a rebuilt run's start only orders it before the runs this Obsidian session starts.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/976
        startedAt: at.timestamp?.epoch ?? 0,
        chat: marker.chat,
      },
    ]);
    if (run) runs.set(at, [...(runs.get(at) ?? at.agentMentions ?? []), run]);
  }
  for (const [at, mentions] of runs) chat.setAgentMentions(at.id, mentions);
}
