import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { readAgentReply, type AgentReply } from "@/agents/agentReply";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { USER_SENDER } from "@/constants";
import { useMemo } from "react";

export interface RelayRun {
  relay: AgentReply;
  run: AgentMention | undefined;
  followedUp: boolean;
}

const NO_RELAYS: ReadonlyMap<string, RelayRun> = new Map();
const parsed = new WeakMap<AgentChatMessage, AgentReply | null>();

function relayOf(message: AgentChatMessage): AgentReply | null {
  if (message.sender !== USER_SENDER) return null;
  if (!parsed.has(message)) parsed.set(message, readAgentReply(message.message));
  return parsed.get(message) ?? null;
}

// A relayed reply is read from the plugin's marker on the message, never from an agent's own reply, and drawn from the run saved on the message that asked; a relay followed by another for the same run was the agent's question.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function relayRuns(messages: readonly AgentChatMessage[]): ReadonlyMap<string, RelayRun> {
  const runs = new Map<string, AgentMention>();
  for (const message of messages) {
    for (const mention of message.agentMentions ?? []) runs.set(mention.id, mention);
  }
  const relays = new Map<string, RelayRun>();
  const latest = new Map<string, RelayRun>();
  for (const message of messages) {
    const relay = relayOf(message);
    if (!relay) continue;
    const { mention } = relay.marker;
    const earlier = latest.get(mention);
    if (earlier) earlier.followedUp = true;
    const entry = { relay, run: runs.get(mention), followedUp: false };
    relays.set(message.id, entry);
    latest.set(mention, entry);
  }
  return relays;
}

export function useRelayRuns(messages: readonly AgentChatMessage[]): ReadonlyMap<string, RelayRun> {
  const gate = useCustomAgentsGate();
  // A lapsed license still shows relayed replies as replies, never as the instructions the chat's agent received.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  const shows = gate === "full" || gate === "locked";
  return useMemo(() => (shows ? relayRuns(messages) : NO_RELAYS), [shows, messages]);
}
