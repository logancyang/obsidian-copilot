import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { readAgentReply, type AgentReply } from "@/agents/agentReply";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import type { RunRef } from "@/agents/ui/chatAgents";
import { USER_SENDER } from "@/constants";
import { useMemo } from "react";

export interface RelayRun {
  relay: AgentReply;
  run: AgentMention | undefined;
}

const NO_RELAYS: ReadonlyMap<string, RelayRun> = new Map();
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

// A saved ask_agent call doesn't name the run it started, so its card finds the run its agent has on the nearest message at or before the call: an ask saves its run on the last message before it, and a message to an agent already working goes to that run.
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

export function useRelayRuns(messages: readonly AgentChatMessage[]): ReadonlyMap<string, RelayRun> {
  const gate = useCustomAgentsGate();
  // A lapsed license still shows relayed replies as replies, never as the instructions the chat's agent received.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  const shows = gate === "full" || gate === "locked";
  return useMemo(() => (shows ? relayRuns(messages) : NO_RELAYS), [shows, messages]);
}
