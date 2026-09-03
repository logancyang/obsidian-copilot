import type { AgentToolKind, SessionUpdate, SessionUsage } from "@/agentMode/session/types";
import type { PiUsage } from "@/pi/types";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

/** Frozen empty update list — pi emits many events that carry no UI change. */
const NO_UPDATES: readonly SessionUpdate[] = Object.freeze([]);

/**
 * Tool kind per pi tool name, so the chat renders the right icon. Unlisted
 * tools fall back to "other" rather than being guessed from the name.
 */
const TOOL_KINDS: Readonly<Record<string, AgentToolKind>> = {
  read_active_note: "read",
  read_note: "read",
  search_vault: "search",
  web_search: "fetch",
};

/** Human-readable card title per pi tool name. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  read_active_note: "Read active note",
  read_note: "Read note",
  search_vault: "Search vault",
  web_search: "Search the web",
};

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
 * Translates one pi tool-execution event into the tool-call updates the chat
 * renders as cards. Pi reports a start and an end per call; the start opens the
 * card and the end settles it as completed or failed.
 *
 * @param event one event from the pi engine's subscription
 */
export function translatePiToolEvent(event: AgentEvent): readonly SessionUpdate[] {
  if (event.type === "tool_execution_start") {
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: TOOL_TITLES[event.toolName] ?? event.toolName,
        kind: TOOL_KINDS[event.toolName] ?? "other",
        status: "in_progress",
        rawInput: event.args,
        vendorToolName: event.toolName,
      },
    ];
  }
  if (event.type === "tool_execution_end") {
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.isError ? "failed" : "completed",
      },
    ];
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
