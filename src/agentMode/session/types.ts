import type { App } from "obsidian";
import type React from "react";
import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import type { CustomModel } from "@/aiParams";
import type CopilotPlugin from "@/main";
import type { CopilotMode, CopilotSettings } from "@/settings/model";
import type { FormattedDateTime, MessageContext } from "@/types/message";
import type { AcpBackend, BackendId } from "@/agentMode/acp/types";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendMetaParser } from "@/agentMode/session/backendMeta";
import type { ModeMapping } from "@/agentMode/session/modeAdapter";

// Re-export so consumers in session/ and ui/ can import a single types entry.
export type { AcpBackend, AcpSpawnDescriptor, BackendId } from "@/agentMode/acp/types";

/** UI-facing install/setup state for a backend. */
export type InstallState =
  | { kind: "absent" }
  | { kind: "ready"; source: "managed" | "custom" }
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

  /**
   * Vendor `_meta` parser for `tool_call` / `tool_call_update` notifications.
   * Returns normalized hints (e.g. `isPlanProposal`) the session layer can
   * branch on without knowing the backend's wire shape. Use
   * `noopBackendMetaParser` when a backend emits no `_meta`.
   */
  readonly meta: BackendMetaParser;

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
   * Optional: parse an agent-native modelId into (baseId, effort). Used by
   * the picker to collapse opencode-style `<provider>/<model>/<variant>`
   * entries into one row plus a sibling effort picker. Effort is `null` for
   * the bare/"Default" variant. Return `null` when the id has no parseable
   * shape (the picker treats it as a standalone entry).
   */
  parseEffortFromModelId?(modelId: string): { baseId: string; effort: string | null } | null;

  /** Inverse of `parseEffortFromModelId`. `effort: null` → bare base id. */
  composeModelId?(baseId: string, effort: string | null): string;

  /**
   * Optional: identify the `SessionConfigOption` that represents effort
   * (claude-code-style). Returning a select option lets the picker build an
   * effort dropdown and apply changes via `setSessionConfigOption`.
   * Different agents use different ids/categories — the descriptor owns the
   * match.
   */
  findEffortConfigOption?(opts: SessionConfigOption[] | null): SessionConfigOption | null;

  /**
   * Optional: persist the user's chosen effort so the next session can
   * replay it. Used only by configOption-style backends — opencode round-
   * trips effort through `selectedModelKey`.
   */
  persistEffortSelection?(value: string, plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: return the canonical → native mode mapping for this backend
   * given the current session state. Returning `null` hides the mode picker
   * for this backend. The mode adapter dispatches on `mapping.kind` to pick
   * between `session/set_mode` and `session/set_config_option`.
   */
  getModeMapping?(
    modeState: SessionModeState | null,
    configOptions: SessionConfigOption[] | null
  ): ModeMapping | null;

  /**
   * Optional: persist the user's chosen mode so the next session can replay
   * it. Called by `AgentSessionManager.persistModeFor`.
   */
  persistModeSelection?(value: CopilotMode, plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: replay persisted state on a freshly created session. Runs
   * once after `createSession` resolves.
   */
  applyInitialSessionConfig?(session: AgentSession, settings: CopilotSettings): Promise<void>;

  /**
   * Optional: when `true`, the session will publish a `currentPlan` snapshot
   * at the end of any plan-mode turn that produced a structured `plan` part,
   * surfacing the floating proposal card for non-permission-gated backends
   * (OpenCode-style). Backends that signal plan completion via a
   * permission-gated tool (Claude Code's `ExitPlanMode`) must leave this
   * unset — the gated path publishes the plan directly and double-emitting
   * would clobber the gated state.
   */
  readonly emitsPlanProposalOnEndOfTurn?: boolean;

  /**
   * Optional: identify backend-managed plan-mode plan files. Returning
   * `true` causes the session to bootstrap a plan card from a successful
   * edit-class tool call writing to that path (opencode-style: the agent
   * authors the plan as markdown under `.opencode/plans/*.md` and there's
   * no permission-gated finalization tool to hook off).
   *
   * Backends that signal plan completion via a permission-gated tool
   * (Claude Code's `ExitPlanMode`) should leave this unset — the gated
   * path already publishes the plan and `maybePromotePlanFileEdit`
   * handles in-place revisions.
   *
   * `cwd` is the session's working directory; pass `null` when unknown
   * (the matcher should still recognize absolute data-dir paths).
   */
  isPlanModePlanFilePath?(absolutePath: string, cwd: string | null | undefined): boolean;

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
 * Decision state surfaced on the floating plan card. `pending` shows the
 * action row; the three terminal states collapse it (the card itself is
 * cleared shortly after by the session, so terminal states are a brief
 * transition, not a persistent display state).
 */
export type PlanProposalDecision = "pending" | "approved" | "rejected" | "rejected_with_feedback";

/** UI action the user invokes from the plan card; resolves into a `PlanProposalDecision`. */
export type PlanDecisionAction = "approve" | "reject" | "feedback";

/**
 * Body shape for a plan proposal. Markdown comes from Claude Code's
 * `ExitPlanMode` tool (`rawInput.plan`) or from re-reading the agent-edited
 * plan file; entries come from OpenCode-style structured `plan`
 * session-updates.
 */
export type PlanProposalBody =
  | { type: "markdown"; text: string }
  | { type: "entries"; entries: AgentPlanEntry[] };

/**
 * Session-level "current plan" singleton. There is at most one of these per
 * session; while the session is in canonical plan mode and a plan exists,
 * the UI renders one floating card pinned to the chat bottom. Updates
 * (Claude editing the plan file, re-issuing ExitPlanMode, OpenCode emitting
 * a fresh structured plan) bump `revision` in place rather than spawning
 * additional cards.
 */
export interface CurrentPlan {
  /**
   * Stable id for the plan-mode "review session". Held constant across
   * in-place revisions so React state on the card and preview tab stays
   * mounted. Reset only when the user resolves the plan or leaves plan
   * mode.
   */
  id: string;
  /** Bumped on every body refresh — used by UI consumers to reset transient state. */
  revision: number;
  /** Markdown body shown in the card teaser and the preview tab. */
  body: PlanProposalBody;
  /** Best-effort title (heading or first line of the body). */
  title: string;
  /**
   * Path of the plan markdown file the agent owns (Claude Code populates this
   * via `ExitPlanMode.rawInput.planFilePath`). When set, Edit / Write tool
   * calls targeting this path while in plan mode trigger a body refresh.
   */
  sourceFilePath?: string;
  /**
   * `true` while a live ACP `ExitPlanMode` permission is awaiting the user's
   * decision. Approve resolves with `allow_once`, Reject with `reject_once`,
   * Feedback rejects + queues the typed message as a follow-up turn.
   *
   * `false` after the gated permission has been resolved (Claude Code
   * follow-up edits) or for backends that signal plan completion at
   * end-of-turn (OpenCode). In that mode Approve switches to canonical
   * `build` and sends `Proceed with the plan.`; Reject is informational.
   */
  permissionGated: boolean;
  /** ACP toolCallId of the live permission, when `permissionGated` is true. */
  pendingToolCallId?: string;
  /** Transient state — typically `pending`; the session clears the plan after a terminal decision. */
  decision: PlanProposalDecision;
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
 * Serialize plan entries to a markdown checklist for the read-only preview.
 * Maps ACP statuses onto GFM task list syntax: pending → unchecked, in_progress
 * → unchecked with a leading "▸", completed → checked.
 */
export function planEntriesToMarkdown(entries: AgentPlanEntry[]): string {
  if (entries.length === 0) return "*(empty plan)*";
  const lines: string[] = ["# Plan", ""];
  for (const e of entries) {
    if (e.status === "completed") {
      lines.push(`- [x] ${e.content}`);
    } else if (e.status === "in_progress") {
      lines.push(`- [ ] ▸ ${e.content}`);
    } else {
      lines.push(`- [ ] ${e.content}`);
    }
  }
  return lines.join("\n");
}

/** Render a plan body as markdown — the canonical text for the preview tab. */
export function planBodyToMarkdown(body: PlanProposalBody): string {
  return body.type === "markdown" ? body.text : planEntriesToMarkdown(body.entries);
}

/** Structural equality on plan bodies — used to skip no-op `setCurrentPlan` notifies. */
export function planBodyEquals(a: PlanProposalBody, b: PlanProposalBody): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "markdown" && b.type === "markdown") return a.text === b.text;
  if (a.type === "entries" && b.type === "entries") {
    if (a.entries.length !== b.entries.length) return false;
    return a.entries.every((e, i) => {
      const o = b.entries[i];
      return e.content === o.content && e.priority === o.priority && e.status === o.status;
    });
  }
  return false;
}

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
