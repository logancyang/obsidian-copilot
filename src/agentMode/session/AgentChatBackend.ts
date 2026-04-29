import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@agentclientprotocol/sdk";
import type { MessageContext } from "@/types/message";
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
  sendMessage(
    text: string,
    context?: MessageContext,
    content?: any[]
  ): { id: string; turn: Promise<void> };
  cancel(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];

  /** True while ACP `session/new` is still in flight. Send is gated on this. */
  isStarting(): boolean;

  /** Latest known model state from ACP, or null when the agent doesn't report one. */
  getModelState(): SessionModelState | null;
  /** Switch the active model. Throws if the agent doesn't implement runtime model switching. */
  setModel(modelId: string): Promise<void>;
  /** Tri-state: null = not yet probed, true/false = result of first probe. */
  isModelSwitchSupported(): boolean | null;

  /** Latest known session configuration options (effort, mode, etc.). */
  getConfigOptions(): SessionConfigOption[] | null;
  /** Set a session config option (e.g. effort). Throws if unsupported. */
  setConfigOption(configId: string, value: string): Promise<void>;
  /** Tri-state: null = not yet probed, true/false = result of first probe. */
  isSetSessionConfigOptionSupported(): boolean | null;

  /** Latest known session mode state (ACP `availableModes`/`currentModeId`). */
  getModeState(): SessionModeState | null;
  /** Switch the active mode via `session/set_mode`. Throws if unsupported. */
  setMode(modeId: string): Promise<void>;
  /** Tri-state: null = not yet probed, true/false = result of first probe. */
  isSetModeSupported(): boolean | null;
}
