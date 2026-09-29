import { AI_SENDER, USER_SENDER } from "@/constants";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import type { AgentChatMessage } from "@/agentMode/session/types";

export interface ReplayTranscriptState {
  messages: AgentChatMessage[];
  current: { sender: string; wireId: string | undefined; text: string } | null;
}

export function createReplayTranscriptState(): ReplayTranscriptState {
  return { messages: [], current: null };
}

export function consumeReplayUpdate(
  state: ReplayTranscriptState,
  update: SessionNotification["update"]
): boolean {
  let sender: string;
  let wireId: string | undefined;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      sender = USER_SENDER;
      wireId = update.messageId ?? undefined;
      break;
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "plan":
      sender = AI_SENDER;
      break;
    case "tool_call_update":
      return true;
    default:
      return false;
  }

  if (startsNewMessage(state.current, sender, wireId)) flushCurrent(state);
  const current = (state.current ??= { sender, wireId, text: "" });
  if (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk"
  ) {
    const { content } = update;
    if (content?.type === "text") current.text += content.text;
  }
  return true;
}

export function finishReplayTranscript(
  state: ReplayTranscriptState
): AgentChatMessage[] | undefined {
  flushCurrent(state);
  return state.messages.length > 0 ? state.messages : undefined;
}

function startsNewMessage(
  current: ReplayTranscriptState["current"],
  sender: string,
  wireId: string | undefined
): boolean {
  if (!current) return true;
  if (current.sender !== sender) return true;
  if (sender !== USER_SENDER) return false;
  return wireId === undefined || wireId !== current.wireId;
}

function flushCurrent(state: ReplayTranscriptState): void {
  const current = state.current;
  state.current = null;
  if (!current) return;
  const message =
    current.sender === USER_SENDER ? stripUserMessageWrapper(current.text) : current.text;
  if (!message.trim()) return;
  state.messages.push({
    id: `acp-loaded-${state.messages.length}`,
    sender: current.sender,
    message,
    isVisible: true,
    timestamp: null,
  });
}
