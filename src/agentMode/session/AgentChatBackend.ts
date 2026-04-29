import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@agentclientprotocol/sdk";
import type { MessageContext } from "@/types/message";
import type { AgentChatMessage, CurrentPlan, PlanDecisionAction } from "./types";

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

  /**
   * Resolve the current plan proposal the user has decided on. Branches on
   * `currentPlan.permissionGated`:
   *   - gated (Claude Code ExitPlanMode): resolves the underlying ACP
   *     permission as allow/deny. Approve auto-continues the agent's turn;
   *     Reject ends the turn; Feedback denies + queues `feedbackText` as a
   *     follow-up user turn after the agent settles.
   *   - non-gated (Claude Code post-rejection plan-file edits, OpenCode
   *     end-of-turn): Approve switches to canonical `build` mode (when the
   *     descriptor advertises one) and sends a `Proceed with the plan.`
   *     follow-up; Reject is informational; Feedback sends `feedbackText`
   *     as the next user turn (mode stays in plan).
   *
   * `proposalId` must match the current `getCurrentPlan().id` — stale
   * resolutions (the user clicked a card that has since been replaced)
   * are silently ignored.
   */
  resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void>;

  /**
   * Singleton plan-mode review state, or `null` when there's nothing to
   * surface. The floating plan card and the editor preview tab read this.
   */
  getCurrentPlan(): CurrentPlan | null;

  /**
   * True when an ExitPlanMode permission is currently pending. The chat input
   * disables itself while one is outstanding so the user is funneled to the
   * proposal card's actions.
   */
  hasPendingPlanPermission(): boolean;
}
