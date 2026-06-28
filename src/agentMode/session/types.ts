import type React from "react";
import type { FormattedDateTime, MessageContext } from "@/types/message";
// `import type` keeps the cycle with `fanoutTypes` compile-time only.
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { ProjectScopeId } from "./scope";

export type {
  BackendAuth,
  BackendAuthStatus,
  BackendDescriptor,
  BackendSignInHandlers,
  BackendUpgradeInfo,
  InstallState,
} from "./descriptor";
export type { CurrentPlan, PlanDecisionAction, PlanProposalDecision } from "./plan";

/** Stable identifier for a registered backend. New backends extend the registry; the type stays open. */
export type BackendId = string;

/**
 * Slim projection of a backend descriptor for UI surfaces that only need to
 * render an agent's identity (label + brand glyph). The shape is decoupled
 * from the full descriptor so consumers depend on just id/label/icon and
 * adding a new backend never requires touching them.
 */
export interface AgentBrand {
  readonly id: BackendId;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
}

/**
 * Opaque identifier for an agent-side session. Backends mint these (ACP
 * agents return one from `session/new`; in-process adapters generate UUIDs);
 * the session layer stores and routes events by it.
 */
export type SessionId = string;

/**
 * Copilot's canonical operational modes for Agent Mode. Each backend's
 * `getModeMapping` projects these onto its own native mode/agent ids.
 *
 *   - `default` — balanced; agent may write/exec but the user must approve
 *                 each permission request. Picked when the user hasn't
 *                 explicitly selected a mode.
 *   - `plan`    — agent drafts a plan; no writes.
 *   - `auto`    — same as default, but bypass all permission prompts.
 */
export type CopilotMode = "default" | "plan" | "auto";

/**
 * Per-backend mapping from canonical Copilot modes to native ids the agent
 * understands. Returned by descriptors via `getModeMapping(...)`.
 *
 *   - `kind: "setMode"`     — apply via the backend's "set mode" channel.
 *     `canonical` values are matched against
 *     `RawModeState.availableModes[].id`.
 *   - `kind: "configOption"`— apply via the backend's "set config option"
 *     channel. `configId` names the option; `canonical` values are matched
 *     against that select option's enum values.
 */
export interface ModeMapping {
  kind: "setMode" | "configOption";
  /** Required when `kind === "configOption"`. Ignored for `setMode`. */
  configId?: string;
  canonical: Partial<Record<CopilotMode, string>>;
  /**
   * Native mode id of the backend's genuine READ-ONLY sandbox (Codex
   * `"read-only"`); unset when none exists. Distinct from `canonical.plan`, which
   * may write plan artifacts (Claude). The fan-out orchestrator applies this.
   */
  readOnlyModeId?: string | null;
}

/** One option in the mode picker — a Copilot-canonical mode the backend supports. */
export interface ModeOption {
  value: CopilotMode;
  label: string;
}

/**
 * One option in the effort picker. `value: null` is the bare/"Default"
 * variant — it always renders as "Default" and selects the unsuffixed
 * modelId (or the bare config-option value, when the backend uses one).
 */
export interface EffortOption {
  value: string | null;
  label: string;
}

/**
 * One entry in the picker's deduped catalog. One entry per base model id;
 * suffix-style variants (codex/opencode) collapse into one entry whose
 * `effortOptions` enumerates the variants.
 */
export interface ModelEntry {
  /**
   * Pure base model id, no provider prefix conventions stripped — for
   * suffix-style backends, this is the wire form minus the trailing
   * effort suffix (e.g. `"openai/gpt-5"`); for descriptor-style
   * (Claude SDK), this is the bare model id (e.g. `"claude-sonnet-4-5"`).
   */
  baseModelId: string;
  /** Human-readable display name. */
  name: string;
  /** Optional one-liner for row subtitle. */
  description?: string;
  /**
   * Normalized Copilot provider id (e.g. `"openai"`, `"anthropic"`). `null`
   * when no provider mapping exists. Pre-computed by the translator.
   */
  provider: string | null;
  /**
   * Effort options for this model. Empty array when the model has no
   * effort dimension (e.g. Claude Haiku, or a suffix-style base with only
   * one variant). `value: null` entries denote the bare/"Default" variant.
   */
  effortOptions: EffortOption[];
}

/**
 * Credential health of an enabled model, derived from its provider row.
 * Drives the agent picker's non-selectable flags so an enabled model is
 * never silently hidden:
 *   - `ok`          — usable (or agent-hosted / native).
 *   - `missing_key` — a required-key provider with no key → "Add API key".
 */
export type EnabledModelCredentialState = "ok" | "missing_key";

/**
 * One entry in a backend's enabled set, enriched for the picker. Lets the
 * picker iterate the *enabled* models (rather than the reported∩enabled
 * intersection) so a model the agent dropped for a missing/expired key still
 * appears, flagged. `baseModelId` is the backend's wire base id (matched
 * against the reported catalog's `ModelEntry.baseModelId`). The signature
 * stays limited to `CopilotSettings` on the descriptor so `session/` needn't
 * import `@/modelManagement` — the backend computes `credentialState`.
 */
export interface EnabledModelEntry {
  baseModelId: string;
  name: string;
  description?: string;
  credentialState: EnabledModelCredentialState;
  /**
   * `true` for an opencode Zen model (opencode's self-hosted free tier). The
   * opencode backend computes this; the UI just renders a privacy warning, so
   * it never needs to know what "Zen" means (`ui` can't import the backend).
   */
  isFree?: boolean;
}

/**
 * Normalized model selection — the single shape used by both runtime
 * state (`BackendState.model.current`) and persisted preferences
 * (`agentMode.backends.<id>.defaultModel`). `baseModelId` is what
 * `BackendDescriptor.wire.decode(wireId).baseModelId` produces for
 * this backend; round-trips through `wire.encode` for the same backend
 * but is meaningless cross-backend (opencode's includes a `provider/`
 * prefix; codex's doesn't). Always read in the context of its
 * backend's slice. `effort` is `null` for "unset" / "default variant"
 * — the translator guarantees it matches one of the corresponding
 * `ModelEntry.effortOptions[].value`.
 */
export interface ModelSelection {
  baseModelId: string;
  effort: string | null;
}

/**
 * Picker-ready model catalog plus the active selection. Both fields are
 * populated together by the translator so they never drift. Consumers
 * that need rich entry data for the current selection look it up via
 * `availableModels.find(e => e.baseModelId === current.baseModelId)`
 * (or the `findModelEntry` helper in `translateBackendState`).
 */
export interface ModelState {
  current: ModelSelection;
  availableModels: ModelEntry[];
  /**
   * Which RPC a model switch should dispatch. `setModel` is the default ACP
   * channel (`session/set_model`). `setConfigOption` is used when the backend
   * advertises its catalog through a generic `category:"model"` select config
   * option (opencode ≥ 1.15.13, where `session/set_model` is gone and the
   * canonical switch is `session/set_config_option`). Set by the translator
   * from which source produced the catalog.
   */
  apply: ModelApplySpec;
}

/**
 * Wire-format codec for a backend's model ids — the only place that
 * knows how a given backend packs `(baseModelId, effort)` into a single
 * `RawModelState.availableModels[].modelId` string.
 *
 * For descriptor-style backends (Claude SDK), effort lives outside the
 * wire id and `effortConfigFor` exposes the `BackendConfigOption`
 * dispatched via `setSessionConfigOption`. For suffix-style backends
 * (codex, opencode), effort is encoded into the wire id and
 * `effortConfigFor` is omitted.
 */
export interface ModelWireCodec {
  /**
   * Encode a normalized selection into the agent's wire-form id. Pure.
   * For descriptor-style backends, effort is ignored here (returned id
   * is the bare `baseModelId`).
   */
  encode(selection: ModelSelection): string;

  /**
   * Decode a wire-form id into a normalized selection plus the Copilot
   * provider attribution used for picker section grouping (`null` when
   * no Copilot provider maps). Pure.
   */
  decode(wireId: string): { selection: ModelSelection; provider: string | null };

  /**
   * Per-model effort source for descriptor-style backends. Returns
   * `null` when the model has no effort dimension (e.g. Claude Haiku)
   * or the backend uses wire-encoded effort instead.
   */
  effortConfigFor?(baseModelId: string): BackendConfigOption | null;
}

/**
 * Apply spec for a mode change. Tells the session layer which RPC the backend
 * should issue. `value` is what the spec carries to the backend; the
 * canonical `CopilotMode` is passed alongside for persistence.
 */
export type ModeApplySpec =
  | { kind: "setMode"; nativeId: string }
  | { kind: "setConfigOption"; configId: string; value: string };

/**
 * Apply spec for a model change — the dispatch channel for `ModelState`.
 * `setModel` issues ACP `session/set_model` (codex, claude, and opencode
 * ≤ 1.15.12). `setConfigOption` issues `session/set_config_option` against the
 * `category:"model"` select id (opencode ≥ 1.15.13). The encoded wire id is the
 * same string in both channels; only the RPC differs. `effortConfigId` records
 * a separate `category:"thought_level"` selector when the backend exposes one.
 */
export type ModelApplySpec =
  | { kind: "setModel" }
  | { kind: "setConfigOption"; configId: string; effortConfigId?: string };

/**
 * Normalized, consumer-facing slice of session state. Produced by
 * `translateBackendState` from neutral catalog inputs plus the descriptor's
 * dispatch hooks. The chat picker, settings UI, and model cache all read
 * from this shape — wire-form modelIds, configOption ids, and ACP-specific
 * quirks (effort in modelId variants vs. configOption; mode in `modes` vs.
 * configOption) never leak across this boundary.
 */
export interface BackendState {
  /**
   * Picker-ready model catalog plus current selection. `null` when the
   * backend doesn't expose runtime model selection.
   */
  model: ModelState | null;

  /**
   * Canonical mode picker, regardless of backend mechanism. `null` when the
   * backend doesn't support modes (or hides them — e.g. Codex).
   */
  mode: {
    /** Canonical projection of the agent's current mode, or `null` if unmapped. */
    current: CopilotMode | null;
    options: ModeOption[];
    /** Per-option apply spec. Picker dispatches `apply[value]` to change the mode. */
    apply: Partial<Record<CopilotMode, ModeApplySpec>>;
  } | null;
}

// ---- Neutral, descriptor-input shapes ----------------------------------

/**
 * One model entry as reported by a backend. Mirrors ACP `ModelInfo` shape
 * but is owned by `session/` so backends and descriptors share a single
 * vocabulary.
 */
export interface BackendModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

/**
 * Raw model state a backend reports at session creation / resume / load —
 * the active modelId plus the list of advertised models. Mirrors ACP
 * `SessionModelState` structurally. Distinct from the picker-ready
 * `ModelState` (the translator output) — this is the pre-translation form.
 */
export interface RawModelState {
  currentModelId: string;
  availableModels: BackendModelInfo[];
}

/** One mode entry as reported by a backend. */
export interface BackendModeInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * Raw mode state a backend reports — the active modeId plus the list of
 * advertised modes. Mirrors ACP `SessionModeState` structurally; passed to
 * `descriptor.getModeMapping`.
 */
export interface RawModeState {
  currentModeId: string;
  availableModes: BackendModeInfo[];
}

/**
 * One configuration option a backend exposes (e.g. claude's "effort"
 * select). Structurally mirrors ACP `SessionConfigOption`. Used as input
 * to `descriptor.getModeMapping` (configOption-mode style) and produced
 * by `ModelWireCodec.effortConfigFor` for descriptor-style effort.
 */
export type BackendConfigOption =
  | {
      id: string;
      type: "select";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: string;
      options: Array<
        | { value: string; name: string; description?: string }
        | {
            name: string;
            description?: string;
            options: Array<{ value: string; name: string; description?: string }>;
          }
      >;
    }
  | {
      id: string;
      type: "boolean";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: boolean;
    };

// ---- Session domain (transport-agnostic) -------------------------------

/**
 * Transport-agnostic content block carried in a user prompt. Mirrors the
 * subset of ACP `ContentBlock` we currently emit; backends translate this
 * to their wire shape at the boundary.
 */
export type PromptContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string };

/**
 * The high-level reason a turn ended. Backends translate from their native
 * stop-reason shape to one of these. Mirrors ACP `StopReason`.
 */
export type StopReason = "end_turn" | "cancelled" | "refusal" | "max_tokens" | "max_turn_requests";

/** Tool kind, narrowed to the categories the UI styles. Mirrors ACP `ToolKind`. */
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
 * Structured output produced by an Agent Mode tool call.
 * Mirrors a subset of ACP's `ToolCallContent` we render inline.
 */
export type AgentToolCallOutput =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

/**
 * One entry of an Agent Mode plan list. Mirrors ACP `PlanEntry`.
 */
export interface AgentPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/**
 * One entry of the session's live execution todo list — the consumer-facing
 * projection of `plan` updates (priority dropped; no surface renders it).
 * Read via `AgentChatBackend.getCurrentTodoList()`.
 */
export interface AgentTodoListEntry {
  content: string;
  status: AgentPlanEntry["status"];
}

/**
 * Initial / updated state for an in-flight tool call. Mirrors ACP `ToolCall`
 * (initial form) — emitted by backends in the `tool_call` `SessionUpdate`.
 */
export interface ToolCallSnapshot {
  toolCallId: string;
  title: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  content?: ToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  /** Vendor-original tool identity (e.g. "Read", "Edit", "ExitPlanMode"). */
  vendorToolName?: string;
  /**
   * MCP server name parsed from a `mcp__<server>__<tool>` qualified name. The
   * UI renders it as a `server · tool` prefix; `vendorToolName` holds the bare
   * tool name. Absent for non-MCP tools.
   */
  mcpServer?: string;
  /** Parent tool-call id, for nested tools (e.g. Claude's Task subagents). */
  parentToolCallId?: string;
  /** True iff this tool call is the agent's plan-finalization signal. */
  isPlanProposal?: boolean;
}

/**
 * Update to an in-flight tool call. Mirrors ACP `ToolCallUpdate`.
 */
export interface ToolCallDelta {
  toolCallId: string;
  title?: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  content?: ToolCallContent[] | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
  vendorToolName?: string;
  /** MCP server name; see `ToolCallSnapshot.mcpServer`. */
  mcpServer?: string;
  parentToolCallId?: string;
  isPlanProposal?: boolean;
}

/**
 * One entry in a tool call's structured `content`. Mirrors a subset of ACP
 * `ToolCallContent` we render inline.
 */
export type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string };

/**
 * Plan summary surfaced via the `plan` `SessionUpdate`. Mirrors ACP `Plan`.
 */
export interface PlanSummary {
  entries: AgentPlanEntry[];
}

/**
 * Tagged-union of streaming session updates emitted by a backend mid-turn
 * (and outside turns for session-info changes). Mirrors ACP's
 * `SessionNotification.update` discriminants. The `state_changed` variant
 * is new — it carries an updated `BackendState` for unsolicited
 * model/mode/configOption deltas, so consumers don't see raw catalog shapes.
 */
export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: PromptContent; messageId?: string }
  | { sessionUpdate: "agent_thought_chunk"; content: PromptContent; messageId?: string }
  | ({ sessionUpdate: "tool_call" } & ToolCallSnapshot)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallDelta)
  | { sessionUpdate: "plan"; entries: AgentPlanEntry[] }
  | { sessionUpdate: "session_info_update"; title?: string | null }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions: BackendConfigOption[] }
  | { sessionUpdate: "state_changed"; state: BackendState };

/** A SessionEvent is the demuxed pair `(sessionId, update)` consumed by handlers. */
export interface SessionEvent {
  sessionId: SessionId;
  update: SessionUpdate;
}

/** Permission option kinds the agent may offer when requesting a decision. */
export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

/** Canonical ordering for `PermissionOptionKind` — used by translators and the modal. */
export const PERMISSION_OPTION_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
];

export const PERMISSION_ALLOW_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
];

export const PERMISSION_REJECT_KINDS: readonly PermissionOptionKind[] = [
  "reject_once",
  "reject_always",
];

/** Single option carried in a `PermissionPrompt`. */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/**
 * A request from the backend asking the user to decide on a tool call.
 * Mirrors ACP `RequestPermissionRequest`.
 */
export interface PermissionPrompt {
  sessionId: SessionId;
  toolCall: ToolCallSnapshot;
  options: PermissionOption[];
}

/** The user's outcome on a `PermissionPrompt`. Mirrors ACP `RequestPermissionResponse`. */
export interface PermissionDecision {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  /**
   * Optional override for the deny `message` surfaced to the agent. Honored
   * only when the selected option resolves to a reject kind on Claude SDK's
   * `canUseTool`. Ignored on allow / cancelled, and silently dropped by ACP
   * backends (the wire schema has no slot for it).
   */
  denyMessage?: string;
}

// ---- Ask-user-question (inline multiple-choice prompt) -----------------

/**
 * One question in an `AskUserQuestionPrompt` — a `header`/`question` pair plus
 * a single- or multi-select option list. Mirrors the Claude SDK's
 * `AskUserQuestion` tool input; backends translate to this shape at the
 * boundary so the inline card stays backend-agnostic.
 */
export interface AgentQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

/**
 * Answer map keyed by question text. Single-select values are the chosen
 * option label; multi-select values are the chosen labels joined with `, `.
 * An empty map signals cancellation (the bridge maps it to a deny).
 */
export type AgentQuestionAnswers = { [questionText: string]: string };

/**
 * A request from the backend asking the user to answer one or more inline
 * multiple-choice questions (Claude SDK's `AskUserQuestion` tool). Routed
 * through the session-domain ask-question prompter and rendered as an inline
 * card at the tail of the chat — the sibling of `PermissionPrompt`.
 * `requestId` reuses the backend's tool-call id so the resolver can pair the
 * answer with the originating call.
 */
export interface AskUserQuestionPrompt {
  sessionId: SessionId;
  requestId: string;
  questions: AgentQuestion[];
}

// ---- MCP server spec (neutral) -----------------------------------------

/**
 * MCP server descriptor passed to backends in `OpenSessionInput.mcpServers`.
 * Mirrors ACP `McpServer` structurally; backends translate to their wire
 * shape at the boundary.
 */
export type McpServerSpec =
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: "http";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
  | {
      type: "sse";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    };

// ---- Project scope ------------------------------------------------------

/**
 * Minimal per-session view of a project's instruction payload. Deliberately
 * decoupled from `aiParams.ProjectConfig` (which still carries legacy CAG
 * fields like `projectModelKey`): a backend that injects project instructions
 * needs only the scope id and the already-parsed, frontmatter-stripped system
 * prompt. The manager maps `ProjectConfig → ProjectProfile` so `backends/`
 * never imports the `projects/` layer.
 */
export interface ProjectProfile {
  id: string;
  systemPrompt: string;
}

// ---- Session-creation I/O shapes ---------------------------------------

export interface OpenSessionInput {
  cwd: string;
  mcpServers: McpServerSpec[];
  /**
   * Scope this session belongs to ({@link ProjectScopeId}); captured like
   * `cwd` so the backend can resolve the owning project's instructions.
   * Absent / `GLOBAL_SCOPE` means the implicit global workspace.
   */
  projectId?: ProjectScopeId;
  /**
   * Absolute paths to widen the agent's searchable roots beyond `cwd` (the
   * project's materialized context directories). Forwarded on every
   * session-lifecycle request (new / resume / load) — resume and load
   * re-establish the complete root list — and only by backends that report
   * {@link BackendProcess.supportsAdditionalDirectories}. Absent / empty means
   * no extra roots.
   */
  additionalDirectories?: string[];
}

export interface OpenSessionOutput {
  sessionId: SessionId;
  state: BackendState;
}

export interface ResumeSessionInput {
  sessionId: SessionId;
  cwd: string;
  mcpServers: McpServerSpec[];
  /** Scope this session belongs to. See {@link OpenSessionInput.projectId}. */
  projectId?: ProjectScopeId;
  /** Extra searchable roots. See {@link OpenSessionInput.additionalDirectories}. */
  additionalDirectories?: string[];
}

export type ResumeSessionOutput = OpenSessionOutput;

export interface LoadSessionInput {
  sessionId: SessionId;
  cwd: string;
  mcpServers: McpServerSpec[];
  /** Scope this session belongs to. See {@link OpenSessionInput.projectId}. */
  projectId?: ProjectScopeId;
  /** Extra searchable roots. See {@link OpenSessionInput.additionalDirectories}. */
  additionalDirectories?: string[];
}

export type LoadSessionOutput = OpenSessionOutput;

export interface PromptInput {
  sessionId: SessionId;
  prompt: PromptContent[];
}

export interface PromptOutput {
  stopReason: StopReason;
}

export interface ListSessionsInput {
  cwd?: string;
}

export interface ListedSessionInfo {
  sessionId: SessionId;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface ListSessionsOutput {
  sessions: ListedSessionInfo[];
}

export interface CancelInput {
  sessionId: SessionId;
}

// ---- Backend process surface -------------------------------------------

/**
 * Generic backend-process surface consumed by `AgentSession`. The ACP runtime
 * (`AcpBackendProcess`) is one implementation; the Claude SDK adapter
 * (`ClaudeSdkBackendProcess`) is another. Keeping this in `session/types.ts`
 * lets `AgentSession` stay backend-agnostic — it depends on the interface,
 * never on a concrete class. All session-domain types are defined above;
 * backends translate to/from their wire format at the boundary.
 */
export type SessionUpdateHandler = (event: SessionEvent) => void;

export interface BackendProcess {
  /**
   * Optional bring-up step. ACP backends spawn the subprocess and run the
   * `initialize` handshake here; in-process adapters (Claude SDK) leave this
   * undefined because they have no async startup phase — their first
   * `newSession`/`prompt` does the bring-up lazily.
   */
  start?(): Promise<void>;
  isRunning(): boolean;
  onExit(listener: () => void): () => void;
  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void;
  /**
   * Optional: register the session-domain handler the backend calls when it
   * needs the user to answer inline multiple-choice questions (Claude SDK's
   * `AskUserQuestion`). Mirrors `setPermissionPrompter`; the prompter routes
   * each request to its owning session, which surfaces an inline card and
   * resolves the returned promise with the answers (or `{}` on cancel).
   * Backends with no equivalent surface (ACP today) omit it.
   */
  setAskUserQuestionPrompter?(
    fn: (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void;
  /**
   * Optional: register a predicate telling the backend whether a session is an
   * ephemeral read-only fan-out sub-session. Backends with their own permission
   * gate (Claude SDK's `canUseTool`) use it to hard-deny write/exec for such
   * sessions; ACP backends governed by the shared prompter omit it.
   */
  setReadOnlySessionPredicate?(fn: (sessionId: SessionId) => boolean): void;
  /**
   * Optional: register the resolver a backend calls to look up a session's
   * project instructions by scope id. Mirrors the prompter setters; the
   * manager supplies a resolver that maps the cached project record to a
   * minimal {@link ProjectProfile}. Returns `undefined` for `GLOBAL_SCOPE`
   * or an unknown project. Only backends that inject project instructions
   * implement it (Claude SDK in PR2b-1); codex/opencode discover AGENTS.md
   * from the session cwd and omit it.
   */
  setProjectProfileProvider?(fn: (projectId: ProjectScopeId) => ProjectProfile | undefined): void;
  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void;
  newSession(params: OpenSessionInput): Promise<OpenSessionOutput>;
  prompt(params: PromptInput): Promise<PromptOutput>;
  cancel(params: CancelInput): Promise<void>;
  setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState>;
  isSetSessionModelSupported(): boolean | null;
  setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState>;
  isSetSessionModeSupported(): boolean | null;
  setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState>;
  isSetSessionConfigOptionSupported(): boolean | null;
  listSessions(params: ListSessionsInput): Promise<ListSessionsOutput>;
  resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput>;
  loadSession(params: LoadSessionInput): Promise<LoadSessionOutput>;
  /**
   * Optional: rebuild a session's display transcript from the backend's own
   * on-disk store, for resuming a native (no-markdown) history entry. The
   * Claude SDK implements this by reading its CLI session jsonl, since
   * `resumeSession` returns no prior messages; ACP backends replay the
   * transcript through `loadSession` instead and omit this.
   */
  readPersistedTranscript?(params: {
    sessionId: SessionId;
    cwd: string;
  }): Promise<AgentChatMessage[]>;
  /**
   * Optional: whether this device's backend store still holds the session,
   * i.e. whether it can actually be resumed here. A synced markdown chat note
   * carries a session id whose transcript lives in a machine-local store
   * (`~/.claude/projects`, opencode/codex session dirs) that does not sync, so
   * a chat started on another device shows up in Recent Chats but dead-ends on
   * resume. Recent Chats uses this to hide those rows. Must be cheap and
   * side-effect free (no subprocess spawn); backends that can't answer cheaply
   * omit it, and the caller then keeps the row.
   */
  sessionExistsLocally?(params: { sessionId: SessionId; cwd: string }): Promise<boolean>;
  /**
   * Whether the backend can route MCP servers of the given transport.
   * ACP runtime probes this from the agent's advertised capabilities; the
   * Claude SDK adapter accepts http/sse natively.
   */
  supportsMcpTransport(transport: "http" | "sse"): boolean;
  /**
   * Whether the backend honors {@link OpenSessionInput.additionalDirectories}
   * (widening the agent's searchable roots on every session-lifecycle request:
   * new / resume / load). Optional like the
   * other incrementally-added capability hooks (`setProjectProfileProvider`):
   * the manager always forwards `additionalDirectories` and each backend gates
   * internally on this before passing them to its wire/SDK. Backends that
   * cannot widen roots omit it or return `false`.
   */
  supportsAdditionalDirectories?(): boolean;
  shutdown(): Promise<void>;
}

/**
 * One structured part inside an Agent Mode assistant message. Used for
 * display only — never serialized into LLM context.
 */
export type AgentMessagePart =
  | {
      kind: "tool_call";
      id: string; // toolCallId
      title: string;
      toolKind?: AgentToolKind;
      status: AgentToolStatus;
      input?: unknown;
      output?: AgentToolCallOutput[];
      locations?: { path: string; line?: number }[];
      /**
       * Vendor tool identity (e.g. "Read", "Edit", "Task", "ExitPlanMode")
       * supplied by the backend adapter. Used by the trail UI to pick a
       * richer tool-aware summary than the ACP `toolKind` enum affords.
       * Absent for backends that surface no vendor identity (opencode, codex).
       */
      vendorToolName?: string;
      /**
       * MCP server name parsed from a `mcp__<server>__<tool>` qualified name.
       * Rendered as a `server · tool` prefix in the trail; `vendorToolName`
       * holds the bare tool name. Absent for non-MCP tools.
       */
      mcpServer?: string;
      /**
       * Parent tool-call id for sub-agent children. Today only Claude
       * Code emits this (Task → child tool calls). Absent → the part is
       * top-level.
       */
      parentToolCallId?: string;
    }
  | {
      kind: "thought";
      text: string;
    }
  | {
      // Streamed assistant prose. Each interruption by a tool_call or thought
      // closes the current text part and opens a new one, so `parts[]` keeps
      // chronological interleaving instead of collapsing prose into one block.
      kind: "text";
      text: string;
    }
  | {
      kind: "plan";
      entries: AgentPlanEntry[];
    };

/**
 * Display message shape for the Agent Mode UI stack. Distinct from the
 * legacy `ChatMessage` because Agent Mode does not feed messages through a
 * LangChain prompt — the agent owns the model's view of the conversation —
 * so we drop `processedText`, `contextEnvelope`, `sources`, `responseMetadata`.
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
  content?: unknown[];
  /**
   * Backend `stopReason` once the turn finishes. Absent while streaming,
   * set when `prompt()` resolves. Only `end_turn` triggers the
   * collapse-research-into-"Worked for X" UI; cancelled / refusal / etc.
   * leave the trail uncollapsed so the user sees what happened.
   */
  turnStopReason?: StopReason;
  /**
   * Wall-clock ms the turn took, frozen at `prompt()` resolution. Stored
   * so re-renders don't shift the "Worked for X" label. Absent until the
   * turn ends.
   */
  turnDurationMs?: number;
  /**
   * Per-agent fan-out state when this assistant message is a multi-agent QA turn.
   * LIVE in-memory only — persistence rides in the body as a composite
   * (`serializeFanoutComposite`) and is reconstructed here on load
   * (`parseFanoutComposite`). When present, the UI renders the tab row.
   */
  fanout?: FanoutTurn;
}

/** Creation shape — id is assigned by the store if absent. */
export type NewAgentChatMessage = Omit<AgentChatMessage, "id"> & { id?: string };
