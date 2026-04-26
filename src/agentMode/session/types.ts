import type { App } from "obsidian";
import type React from "react";
import type { CustomModel } from "@/aiParams";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { FormattedDateTime, MessageContext } from "@/types/message";
import type { AcpBackend, BackendId } from "@/agentMode/acp/types";

// Re-export so consumers in session/ and ui/ can import a single types entry.
export type { AcpBackend, AcpSpawnDescriptor, BackendId } from "@/agentMode/acp/types";

/** UI-facing install/setup state for a backend. */
export type InstallState =
  | { kind: "absent" }
  | { kind: "ready"; version: string; source: "managed" | "custom" }
  | { kind: "error"; message: string };

/**
 * Backend-agnostic descriptor consumed by `session/` and `ui/`. Each backend
 * exports one of these from its own folder; the registry maps `BackendId →
 * BackendDescriptor`. Adding a new backend is exactly: implement `AcpBackend`,
 * export a `BackendDescriptor`, register it. No edits to session or UI.
 */
export interface BackendDescriptor {
  readonly id: BackendId;
  readonly displayName: string;

  /** Sync read of install/setup state from settings + last-known disk reconcile. */
  getInstallState(settings: CopilotSettings): InstallState;

  /** Subscribe to settings/disk changes affecting install state. Returns unsubscribe. */
  subscribeInstallState(plugin: CopilotPlugin, cb: () => void): () => void;

  /** Open backend-specific install/setup modal. */
  openInstallUI(plugin: CopilotPlugin): void;

  /** Construct the `AcpBackend` the session manager will spawn. */
  createBackend(plugin: CopilotPlugin): AcpBackend;

  /** Optional: backend-specific settings panel. Rendered inside the Agent Mode tab. */
  SettingsPanel?: React.FC<{ plugin: CopilotPlugin; app: App }>;

  /** Optional: reconcile install state on plugin load (e.g. clear stale managed install). */
  onPluginLoad?(plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: partition Copilot's `activeModels` into models this backend can
   * route (`compatible`) and the ones it cannot (`incompatible`, surfaced
   * disabled in the picker so users see why their Bedrock/Ollama models
   * aren't selectable).
   */
  filterCopilotModels?(models: CustomModel[]): {
    compatible: CustomModel[];
    incompatible: CustomModel[];
  };

  /**
   * Optional: resolve the user's sticky model preference, translated into the
   * agent-native id (whatever appears in `SessionModelState.availableModels`).
   * Returning `undefined` means "no preference, use whatever the agent picks
   * by default".
   */
  getPreferredModelId?(settings: CopilotSettings): string | undefined;

  /**
   * Optional: persist the user's selection so the next session resumes it.
   * `modelId` is the agent-native id passed to `unstable_setSessionModel`.
   */
  persistModelSelection?(modelId: string, plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: translate a Copilot `CustomModel` into the agent-native model id
   * the backend will report in `availableModels`. Returns `undefined` when
   * the model's provider isn't routable by this backend. The UI uses this for
   * cross-referencing source attribution and computing the picker's value.
   */
  copilotModelKeyToAgentModelId?(model: CustomModel): string | undefined;

  /**
   * Optional: given an agent-reported modelId, return the Copilot provider id
   * (matching `CustomModel.provider`) the model would route through. Returns
   * `undefined` for agent-only models that don't correspond to any Copilot
   * provider. The picker uses this to decide whether the user has curated a
   * provider in Copilot — if they have configured any model for that
   * provider, the agent's catalog for the same provider is hidden in favor
   * of the user's explicit list (so a single configured OpenRouter model
   * doesn't drag in OpenCode's full OpenRouter catalog).
   */
  agentModelIdToCopilotProvider?(modelId: string): string | undefined;

  /**
   * Optional: previously-stored ACP sessionId of the backend's dedicated
   * "probe session", used by `AgentModelPreloader` to enumerate live models
   * across plugin reloads without accumulating one fresh agent-side session
   * record per startup. Returns `undefined` when no probe has run yet.
   */
  getProbeSessionId?(settings: CopilotSettings): string | undefined;

  /**
   * Optional: persist the probe sessionId returned by a successful
   * `session/new` probe so the next plugin load can reuse it via
   * `session/resume` or `session/load`. Only called by `AgentModelPreloader`.
   */
  persistProbeSessionId?(sessionId: string, plugin: CopilotPlugin): Promise<void>;
}

/**
 * Structured output produced by an Agent Mode tool call.
 * Mirrors a subset of ACP's `ToolCallContent` we render inline.
 */
export type AgentToolCallOutput =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

/**
 * ACP tool kind, narrowed to the categories the UI styles. Matches
 * @agentclientprotocol/sdk's `ToolKind`.
 */
export type AgentToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AgentToolStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * Single entry of an Agent Mode plan list. Shape mirrors ACP `PlanEntry`.
 */
export interface AgentPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/**
 * One structured part inside an Agent Mode assistant message. Used for
 * display only — never serialized into LLM context.
 */
export type AgentMessagePart =
  | {
      kind: "tool_call";
      id: string; // ACP toolCallId
      title: string;
      toolKind?: AgentToolKind;
      status: AgentToolStatus;
      input?: unknown;
      output?: AgentToolCallOutput[];
      locations?: { path: string; line?: number }[];
    }
  | {
      kind: "thought";
      text: string;
    }
  | {
      kind: "plan";
      entries: AgentPlanEntry[];
    };

/**
 * Display message shape for the Agent Mode UI stack. Distinct from the
 * legacy `ChatMessage` because Agent Mode does not feed messages through a
 * LangChain prompt — ACP owns the model's view of the conversation — so we
 * drop `processedText`, `contextEnvelope`, `sources`, `responseMetadata`.
 */
export interface AgentChatMessage {
  id: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  /** Display text (assistant body or user input). */
  message: string;
  /** Assistant-only structured parts (tool calls, thoughts, plans). */
  parts?: AgentMessagePart[];
  /** User messages may carry context (notes, urls, etc.). */
  context?: MessageContext;
  /** Images / rich content for user messages. */
  content?: any[];
}

/** Creation shape — id is assigned by the store if absent. */
export type NewAgentChatMessage = Omit<AgentChatMessage, "id"> & { id?: string };
