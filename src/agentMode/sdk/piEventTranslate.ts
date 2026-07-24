import type { SessionUpdate, SessionUsage } from "@/agentMode/session/types";
import type { PiUsage } from "@/pi/types";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

/** Frozen empty update list — pi emits many events that carry no UI change. */
const NO_UPDATES: readonly SessionUpdate[] = Object.freeze([]);

/**
 * Translates one pi conversation event into the session-domain updates the
 * Agent Mode UI consumes. Pi streams assistant text and reasoning as separate
 * delta channels, which map onto the message and thought chunk updates the
 * chat already renders for every other backend.
 *
 * @param event one event from the pi engine's subscription
 * @returns the updates to dispatch, empty when the event carries no UI change
 */
export function translatePiEvent(event: AgentEvent): readonly SessionUpdate[] {
  if (event.type !== "message_update") return NO_UPDATES;
  const delta = event.assistantMessageEvent;
  if (delta.type === "text_delta") {
    return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta.delta } }];
  }
  if (delta.type === "thinking_delta") {
    return [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: delta.delta } }];
  }
  return NO_UPDATES;
}

/**
 * Projects the engine's token accounting onto the backend-agnostic usage
 * snapshot the context meter reads. `contextWindow` is omitted when the model
 * reports none, which the session treats as a count-only snapshot rather than
 * letting it overwrite a snapshot that knows the window.
 *
 * @param usage the engine's latest accounting
 * @param updatedAt timestamp to stamp the snapshot with
 */
export function toSessionUsage(usage: PiUsage, updatedAt: number): SessionUsage {
  return {
    usedTokens: usage.contextTokens,
    ...(usage.contextWindow > 0 ? { contextWindow: usage.contextWindow } : {}),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    updatedAt,
  };
}
