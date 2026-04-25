import type { AgentChatMessage } from "./types";

/**
 * Narrow interface the Agent Mode UI tree consumes. Implemented by
 * `AgentChatUIState`. Distinct from the legacy `ChatUIState` because Agent
 * Mode has no edit/regenerate/persistence flow and no chain-type or
 * include-active-note plumbing — ACP owns those concerns server-side.
 *
 * `sendMessage` returns `{ id, turn }` so the caller can synchronously read
 * the new user message id (for input history) and separately await the full
 * turn for loading-state management.
 */
export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(text: string, content?: any[]): { id: string; turn: Promise<void> };
  cancel(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];
}
