/**
 * In-process driver for the Claude Agent SDK that implements `BackendProcess`,
 * the same interface `AgentSession` consumes for ACP backends. Every SDK
 * message is translated to a session-domain `SessionEvent` and dispatched to
 * the per-session handler. From `AgentSession`'s perspective there's no
 * difference between this adapter and `AcpBackendProcess`.
 *
 * Lifecycle differs from ACP: there's no long-lived subprocess. Each
 * `prompt()` call starts a fresh `query()` (with `resume: <sessionId>` after
 * the first turn so the SDK loads prior conversation state).
 */
import { logError, logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";
import {
  query,
  type EffortLevel,
  type HookCallback,
  type ModelInfo,
  type Options,
  type PermissionMode,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import { parseClaudeTranscript } from "./claudeSessionTranscript";
import { readClaudePlanUsage } from "./claudePlanUsage";
import { withoutExpiredWindows } from "@/agentMode/session/planUsage";
import type {
  PlanUsage,
  AgentChatMessage,
  BackendConfigOption,
  BackendDescriptor,
  BackendProcess,
  RawModelState,
  RawModeState,
  BackendState,
  CancelInput,
  ListSessionsInput,
  ListSessionsOutput,
  LoadSessionInput,
  LoadSessionOutput,
  OpenSessionInput,
  OpenSessionOutput,
  PermissionDecision,
  PermissionPrompt,
  PromptInput,
  PromptOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
  StopReason,
} from "@/agentMode/session/types";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import { AuthRequiredError, MethodUnsupportedError } from "@/agentMode/session/errors";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { createClaudeTaskPlanState, type ClaudeTaskPlanState } from "./claudeTodoPlan";
import { ClaudeBackgroundTaskStateMachine } from "./claudeTaskProtocol";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";
import { PermissionBridge, type AskUserQuestionPrompter } from "./permissionBridge";
import {
  getCachedSdkCatalog,
  probeClaudeSdkCatalog,
  resolveSeedModelId,
  synthesizeEffortConfigOption,
} from "./effortOption";
import {
  describeSdkMessage,
  logSdkError,
  logSdkInbound,
  logSdkOutbound,
  logSdkOutboundResult,
} from "./sdkDebugTap";
import { guardSdkStreamStall } from "./sdkStreamStallGuard";

interface SessionState {
  cwd: string | null;
  /**
   * Scope this session belongs to, captured from the Open/Resume input so the
   * SDK can resolve the owning project's instructions. One claude process can
   * host many sessions across different projects; the projectId lives per
   * session (not process-global) so each resolves its own instructions.
   * `undefined` / `GLOBAL_SCOPE` means the implicit global workspace.
   */
  projectId?: ProjectScopeId;
  /**
   * Drives whether the next `query()` passes `resume: <sessionId>` (continue
   * the persisted conversation) or `sessionId: <ourId>` (mint a new SDK-side
   * session with our pre-allocated id).
   */
  firstPromptStarted: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  /**
   * Effort tier passed to `query()`'s `options.effort` on the next prompt.
   * The vocabulary is per-model — the runtime catalog
   * (`ModelInfo.supportedEffortLevels`) is the source of truth and is
   * pulled via `ensureModelCatalog()`.
   */
  effort?: EffortLevel;
  /**
   * Absolute extra workspace roots captured from the Open/Resume input,
   * forwarded into `options.additionalDirectories` on every `query()` for this
   * session. The SDK option is stable (`sdk.d.ts`), so unlike the ACP backends
   * this needs no capability gate. Absent / empty means cwd is the only root.
   */
  additionalDirectories?: string[];
  /**
   * Session-lived todo/Task accumulator shared across this session's queries
   * (translator state is per-query; Task ids must survive turns).
   */
  claudeTaskPlan: ClaudeTaskPlanState;
  /** Session-lived correlation for background launches that outlast one query. */
  backgroundTasks: ClaudeBackgroundTaskStateMachine;
  active?: Query;
  /**
   * Snapshot of the composed Copilot system prompt (base framing + pill-syntax
   * directive + built-in tool guidance) captured at `newSession()` time.
   * Empty string = no append. Appended to Claude's default `claude_code`
   * preset via `options.systemPrompt.append`.
   */
  systemPromptAppend: string;
}

const FOREGROUND_ONLY_TOOLS = new Set(["Agent", "Task", "Bash"]);
const REMOTE_AGENT_DENIAL_REASON =
  "Remote-isolated agents require background execution, which is temporarily unavailable in Copilot v4.";

/**
 * Keeps v4 Claude turns on the query lifecycle that can deliver their complete result.
 * Background work becomes safe again once the adapter owns a persistent response consumer.
 */
export const enforceForegroundToolUse: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || !FOREGROUND_ONLY_TOOLS.has(input.tool_name)) {
    return {};
  }
  const toolInput =
    typeof input.tool_input === "object" &&
    input.tool_input !== null &&
    !Array.isArray(input.tool_input)
      ? (input.tool_input as Record<string, unknown>)
      : {};
  if (
    (input.tool_name === "Agent" || input.tool_name === "Task") &&
    toolInput.isolation === "remote"
  ) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: REMOTE_AGENT_DENIAL_REASON,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, run_in_background: false },
    },
  };
};

export interface ClaudeSdkBackendProcessOptions {
  pathToClaudeCodeExecutable: string;
  app: App;
  clientVersion: string;
  descriptor: BackendDescriptor;
  /**
   * Read at the start of every `prompt()` so a settings change live-applies on
   * the next turn.
   */
  getEnableThinking?: () => boolean;
  /**
   * Predicate identifying plan-mode plan files (e.g. `~/.claude/plans/*.md`).
   * When set, `Write` calls targeting these paths are auto-allowed via
   * `canUseTool`; every other `Write` is routed through the permission
   * prompter like any other tool.
   */
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  /**
   * Returns the user's persisted model preference. Read at session start
   * to seed `session.model` from the live catalog (so the SDK uses what
   * the picker shows, instead of falling back to its own internal default).
   */
  getDefaultModelId?: () => string | undefined;
  /**
   * Returns the composed Copilot system prompt to append to Claude's default
   * `claude_code` system prompt (base Obsidian framing + pill-syntax directive).
   * Read once per `newSession()` so a settings change
   * applies to the next session rather than mid-turn. Empty string / undefined
   * disables the append.
   */
  getSystemPromptAppend?: () => string | undefined;
  /**
   * User-defined env vars merged onto `process.env` for the spawned `claude`
   * CLI. Read per `prompt()` so settings edits apply on the next turn.
   */
  getEnvOverrides?: () => Record<string, string> | undefined;
  /**
   * Plugin-managed env merged onto `process.env` before user overrides (e.g.
   * credentials and runtime paths for builtin skills). Supplied by the
   * descriptor so `sdk/` need not import `backends/`. Read per `prompt()`.
   */
  getManagedEnv?: () => Promise<Readonly<Record<string, string>>>;
  /**
   * Resolve whether the `claude` CLI is signed in (OAuth login or env-based
   * credentials). Consulted once before the first prompt; an unauthenticated
   * result makes `prompt()` reject with `AuthRequiredError` instead of
   * silently resolving with an empty turn. The result is cached until a turn
   * ends without output, which forces a re-check (covers mid-session expiry).
   */
  checkAuth?: () => Promise<boolean>;
  /**
   * Rejects when the external Claude Code CLI cannot provide the protocol
   * guarantees this adapter relies on. Checked before opening any session.
   */
  checkCompatibility?: () => Promise<void>;
}

/**
 * Static mode catalog for the Claude SDK — the native modes the descriptor is
 * allowed to project onto Copilot's canonical picker. `acceptEdits`, `auto`,
 * and `bypassPermissions` are all candidates for the `auto` pill; the
 * descriptor's mapping picks one, so listing all three here does not widen the
 * picker. `dontAsk` is intentionally excluded.
 */
const STATIC_SDK_MODES: RawModeState = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
    { id: "acceptEdits", name: "Accept Edits" },
    { id: "auto", name: "Auto" },
    { id: "bypassPermissions", name: "Bypass Permissions" },
  ],
};

export class ClaudeSdkBackendProcess implements BackendProcess {
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  private readonly pendingUpdates = new Map<SessionId, SessionEvent[]>();

  /**
   * Last plan-cap snapshot read from any session on this process.
   *
   * The caps belong to the account, not to a conversation, so one session's reading is
   * true for every other. Held here and replayed on attach, a new or switched chat shows
   * the caps immediately instead of blanking until its own first turn.
   */
  private lastPlanUsage: PlanUsage | null = null;
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private readonly sessions = new Map<SessionId, SessionState>();
  private permissionPrompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private askUserQuestionPrompter: AskUserQuestionPrompter | null = null;
  private isReadOnlySession: ((sessionId: SessionId) => boolean) | null = null;
  private exitListeners = new Set<() => void>();
  private shuttingDown = false;
  private readonly bridge: PermissionBridge;
  /**
   * Process-scoped cache of the SDK's model catalog. Populated lazily by
   * `ensureModelCatalog()` so we only spawn one extra `claude` subprocess
   * per backend lifetime.
   */
  private cachedModels: ModelInfo[] | null = null;
  private cachedModelsProbe: Promise<ModelInfo[]> | null = null;
  /**
   * Cleared whenever a turn ends without output so the next prompt re-checks
   * sign-in state; set true once `checkAuth` confirms the CLI is signed in.
   */
  private authConfirmed = false;
  private compatibilityConfirmed = false;
  private compatibilityProbe: Promise<void> | null = null;

  constructor(private readonly opts: ClaudeSdkBackendProcessOptions) {
    this.bridge = new PermissionBridge({
      getPrompter: () => this.permissionPrompter,
      getAskUserQuestionPrompter: () => this.askUserQuestionPrompter,
      isPlanModePlanFilePath: opts.isPlanModePlanFilePath,
      getIsReadOnlySession: () => this.isReadOnlySession,
    });
    logInfo(
      `[AgentMode] ClaudeSdkBackendProcess constructed (claude=${opts.pathToClaudeCodeExecutable})`
    );
  }

  isRunning(): boolean {
    return !this.shuttingDown;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void {
    this.permissionPrompter = fn;
  }

  setReadOnlySessionPredicate(fn: (sessionId: SessionId) => boolean): void {
    this.isReadOnlySession = fn;
  }

  setAskUserQuestionPrompter(fn: AskUserQuestionPrompter): void {
    this.askUserQuestionPrompter = fn;
  }

  private resolveSystemPromptAppend(): string {
    return this.opts.getSystemPromptAppend?.() ?? "";
  }

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const event of buffered) {
        try {
          handler(event);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered SDK event threw for ${sessionId}`, e);
        }
      }
    }
    // Expired windows are dropped rather than replayed: this process outlives many
    // chats, and a snapshot taken before a reset describes a period that has ended.
    this.lastPlanUsage = this.lastPlanUsage && withoutExpiredWindows(this.lastPlanUsage);
    if (this.lastPlanUsage) {
      try {
        handler({
          sessionId,
          update: { sessionUpdate: "plan_usage_update", planUsage: this.lastPlanUsage },
        });
      } catch (e) {
        logWarn(`[AgentMode] replay of plan usage threw for ${sessionId}`, e);
      }
    }
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    logSdkOutbound("newSession", {
      cwd: params.cwd,
      projectId: params.projectId ?? null,
    });
    await this.ensureCompatible();
    const sessionId = uuidv4();
    const cwd = params.cwd ?? null;
    // Resolve the catalog before returning so the picker never sees an
    // empty model list. On a probe miss, at most one subprocess is
    // spawned (deduped via cachedModelsProbe).
    const catalog = await this.ensureModelCatalog();
    const defaultId = this.opts.getDefaultModelId?.();
    const seedModelId = resolveSeedModelId(catalog, defaultId);

    this.sessions.set(sessionId, {
      cwd,
      projectId: params.projectId,
      firstPromptStarted: false,
      model: seedModelId,
      additionalDirectories: params.additionalDirectories,
      systemPromptAppend: this.resolveSystemPromptAppend(),
      claudeTaskPlan: createClaudeTaskPlanState(),
      backgroundTasks: new ClaudeBackgroundTaskStateMachine(),
    });

    const state = this.computeState(sessionId);
    logSdkOutboundResult(
      "newSession",
      { sessionId, currentModelId: seedModelId ?? null, hasEffort: state.model !== null },
      sessionId
    );
    return { sessionId, state };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }

    // Deterministic sign-in gate. Without it, an unauthenticated CLI yields a
    // non-success result with an empty `errors` array, which maps to
    // `stopReason: "cancelled"` and slips past `runTurn`'s empty-turn net —
    // leaving an empty assistant bubble and no error. Checked once per backend
    // lifetime (cached) so signed-in turns pay nothing.
    if (this.opts.checkAuth && !this.authConfirmed) {
      if (await this.opts.checkAuth()) {
        this.authConfirmed = true;
      } else {
        throw new AuthRequiredError(
          "You're not signed in to Claude. Use the Sign in button above the chat box to continue."
        );
      }
    }

    // Streaming-input mode (AsyncIterable) is required to expose
    // interrupt/setModel/setPermissionMode on the returned Query — without it
    // those control calls reject with "only available in streaming input mode".
    const messageContent = promptInputToAnthropicContent(params);
    const promptStream = makePromptStream(messageContent, params.sessionId);

    this.bridge.setSessionContext(params.sessionId);

    const options: Options = {
      pathToClaudeCodeExecutable: this.opts.pathToClaudeCodeExecutable,
      cwd: session.cwd ?? undefined,
      includePartialMessages: true,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "LS"],
      disallowedTools: ["TaskOutput", "Workflow", "Monitor"],
      canUseTool: this.bridge.canUseTool,
    };
    // Append the composed Copilot system prompt (captured at newSession time)
    // to Claude's default `claude_code` preset. The SDK's preset+append form
    // preserves the full default system prompt — keeping Claude's tool and
    // planning framing — while layering on the Obsidian-vault identity, the
    // pill-syntax directive, and Copilot's built-in tool guidance.
    //
    // `excludeDynamicSections` keeps that whole prefix cacheable: the preset
    // otherwise stamps working directory, git status, and memory paths into the
    // system prompt, so switching project or crossing midnight would invalidate
    // it. The SDK re-injects that content as the first user message, so the
    // model still has the facts — they just stop sitting in the cached prefix.
    // Sent unconditionally; it is about the preset, not about our append.
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      append: session.systemPromptAppend || undefined,
    };
    if (session.firstPromptStarted) {
      options.resume = params.sessionId;
    } else {
      // First turn: tell the SDK to use *our* pre-allocated session id so
      // future `resume` calls match.
      options.sessionId = params.sessionId;
    }
    if (session.model) options.model = session.model;
    if (session.permissionMode) options.permissionMode = session.permissionMode;
    if (session.effort) options.effort = session.effort;
    // Widen the agent's searchable roots beyond cwd. The SDK option is stable,
    // so this is forwarded unconditionally (no capability gate) whenever the
    // session captured extra roots at open/resume.
    if (session.additionalDirectories?.length) {
      options.additionalDirectories = session.additionalDirectories;
    }
    // Keep the toggle authoritative. Leaving `thinking` unset when off lets the
    // model's default take over — Sonnet 4.6 / Opus 4.6 default to adaptive
    // "summarized", so reasoning keeps streaming — so disable it explicitly.
    // When on, Opus 4.7+ defaults display to "omitted" (summaries never reach
    // the UI), so force "summarized" (pre-4.7 models default to summarized).
    options.thinking = this.opts.getEnableThinking?.()
      ? { type: "adaptive", display: "summarized" }
      : { type: "disabled" };
    const envOverrides = this.opts.getEnvOverrides?.();
    // Builtin skills consume plugin-managed credentials and runtime paths. The
    // descriptor supplies them via `getManagedEnv` (sdk/ can't import
    // backends/); user overrides are merged last so they can still shadow them.
    const managedEnv = (await this.opts.getManagedEnv?.()) ?? {};
    const extraEnv = { ...managedEnv, ...envOverrides };
    if (Object.keys(extraEnv).length > 0) {
      // Options.env replaces (not merges with) the child env, so include
      // process.env to preserve PATH and friends.
      options.env = { ...process.env, ...extraEnv };
    }

    // Each prompt currently owns one finite SDK query. Keep work foregrounded
    // until a persistent consumer can receive results after that query returns.
    options.hooks = { PreToolUse: [{ hooks: [enforceForegroundToolUse] }] };

    logSdkOutbound(
      "prompt",
      {
        prompt: summarizePromptContent(messageContent),
        resume: options.resume ?? null,
        sessionIdSeed: options.sessionId ?? null,
        model: options.model ?? null,
        permissionMode: options.permissionMode ?? null,
        effort: options.effort ?? null,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
      },
      params.sessionId
    );

    // Abort the query if the response stream goes half-open mid-message: that
    // would otherwise park the loop below forever and wedge the turn in a
    // permanent "running" state. `guardSdkStreamStall` owns the watchdog and
    // throws `SDK_STREAM_STALL_MESSAGE` (surfaced to the user) if it trips.
    const turnAbort = new AbortController();
    options.abortController = turnAbort;

    const q = query({ prompt: promptStream, options });
    session.active = q;
    session.firstPromptStarted = true;
    const stream = guardSdkStreamStall(q, {
      abortController: turnAbort,
      // The thrown stall error lands as an in-chat error on the turn (via
      // `AgentSession`'s catch → `markMessageError`); this just records it in
      // the frame trace.
      onStall: (idleMs) => logSdkError("←", "stream:stalled", { idleMs }, params.sessionId),
    });

    const translatorState = createTranslatorState(session.claudeTaskPlan, session.backgroundTasks);
    let stopReason: StopReason = "end_turn";
    let resultErrorMessage: string | null = null;
    try {
      let planUsageRequested = false;
      for await (const sdkMsg of stream) {
        if (this.shuttingDown) break;
        logSdkInbound(describeSdkMessage(sdkMsg), sdkMsg, params.sessionId);
        // Ask for the plan caps on the very first message of the turn, whatever it is.
        // The usage API is a control request on the query, so it only answers while the
        // query is open — and the window is narrower than it looks. With partial
        // streaming on, `assistant` lands about ten milliseconds before `result`, at
        // which point the query is already closing and the read is rejected with "Query
        // closed before response received". The first message (a `system` init) leaves
        // more than a second of headroom.
        if (!planUsageRequested) {
          planUsageRequested = true;
          void this.refreshPlanUsage(q);
        }
        const events = translateSdkMessage(sdkMsg, params.sessionId, translatorState);
        for (const e of events) this.dispatchEvent(e);
        if (sdkMsg.type === "result") {
          stopReason = mapStopReason(sdkMsg);
          if (sdkMsg.subtype === "success" && sdkMsg.is_error && sdkMsg.result.trim()) {
            resultErrorMessage = sdkMsg.result;
          } else if (stopReason !== "end_turn" && sdkMsg.subtype !== "success") {
            const errs = "errors" in sdkMsg ? sdkMsg.errors : undefined;
            if (errs && errs.length > 0) {
              resultErrorMessage = errs.join("; ");
            } else {
              // Non-success with no error detail can mean the saved login
              // expired mid-session. Force the next prompt to re-verify auth
              // rather than trusting the cached "signed in" flag.
              this.authConfirmed = false;
            }
          }
          break;
        }
      }
    } finally {
      if (session.active === q) session.active = undefined;
      this.bridge.clearSessionContext();
    }

    if (resultErrorMessage) {
      logSdkError("→", "prompt", { error: resultErrorMessage }, params.sessionId);
      throw new Error(resultErrorMessage);
    }
    logSdkOutboundResult("prompt", { stopReason }, params.sessionId);
    return { stopReason };
  }

  async cancel(params: CancelInput): Promise<void> {
    logSdkOutbound("cancel", {}, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session?.active) return;
    try {
      await session.active.interrupt();
    } catch (e) {
      logWarn("[AgentMode] SDK query.interrupt() threw", e);
      logSdkError("→", "interrupt", { error: err2String(e) }, params.sessionId);
    }
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    logSdkOutbound("setSessionModel", { modelId: params.modelId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    session.model = params.modelId;
    if (this.cachedModels && session.effort) {
      const info = this.cachedModels.find((m) => m.value === params.modelId);
      const levels = info?.supportedEffortLevels ?? [];
      if (!levels.includes(session.effort)) {
        session.effort = levels[0];
      }
    }
    if (session.active) {
      try {
        await session.active.setModel(params.modelId);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setModel() threw (will apply on next turn)", e);
        logSdkError("→", "setModel", { error: err2String(e) }, params.sessionId);
      }
    }
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  async setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
    logSdkOutbound("setSessionMode", { modeId: params.modeId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    const mode = canonicalModeToSdk(params.modeId);
    if (!mode) {
      throw new Error(`Unsupported mode ${params.modeId}`);
    }
    session.permissionMode = mode;
    if (session.active) {
      try {
        await session.active.setPermissionMode(mode);
      } catch (e) {
        logWarn("[AgentMode] SDK query.setPermissionMode() threw (will apply on next turn)", e);
        logSdkError("→", "setPermissionMode", { error: err2String(e) }, params.sessionId);
      }
    }
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
  }

  isSetSessionModeSupported(): boolean | null {
    return true;
  }

  /**
   * Only `effort` is exposed as a session config option for this backend.
   * We synthesize the option from the SDK's per-model
   * `ModelInfo.supportedEffortLevels`, store the pick on the session, and
   * apply it as `options.effort` on the next `query()` — the SDK has no
   * runtime RPC for changing effort mid-turn.
   */
  async setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState> {
    logSdkOutbound(
      "setSessionConfigOption",
      { configId: params.configId, value: params.value },
      params.sessionId
    );
    if (params.configId !== "effort") {
      throw new MethodUnsupportedError("session/set_config_option");
    }
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    const models = await this.ensureModelCatalog();
    const modelInfo = models.find((m) => m.value === session.model);
    const levels = modelInfo?.supportedEffortLevels ?? [];
    if (!levels.includes(params.value as EffortLevel)) {
      throw new Error(
        `Effort '${params.value}' not supported by ${session.model ?? "default model"}`
      );
    }
    session.effort = params.value as EffortLevel;
    const state = this.computeState(params.sessionId);
    this.dispatchStateChanged(params.sessionId, state);
    return state;
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return true;
  }

  async listSessions(_params: ListSessionsInput): Promise<ListSessionsOutput> {
    throw new MethodUnsupportedError("session/list");
  }

  /**
   * Rebuild a session's display transcript by reading the Claude CLI's on-disk
   * record at `<config>/projects/<encoded-cwd>/<sessionId>.jsonl`. The SDK
   * exposes no transcript API and `resumeSession` returns no prior messages,
   * so this is how a native (autosave-off) Claude chat shows its conversation
   * when reopened from recent chats. Best-effort: a missing/GC'd file or a
   * custom config dir we can't resolve degrades to an empty transcript (the
   * session still resumes; only the visible scrollback is absent).
   *
   * `CLAUDE_CONFIG_DIR` is resolved with the SAME precedence the SDK is
   * spawned with (`env overrides` > managed env > `process.env`), so a user
   * who points Claude at a custom config dir via Agent Mode's env overrides
   * still gets their transcript read from the right place. The project dir
   * name is the cwd with every non-alphanumeric character replaced by `-`,
   * matching the CLI's own encoding.
   */
  async readPersistedTranscript(params: {
    sessionId: SessionId;
    cwd: string;
  }): Promise<AgentChatMessage[]> {
    try {
      const { readFile } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      const file = await this.claudeTranscriptPath(params.sessionId, params.cwd);
      const text = await readFile(file, "utf8");
      return parseClaudeTranscript(text);
    } catch (err) {
      logWarn(`[AgentMode] could not read Claude transcript for ${params.sessionId}`, err);
      return [];
    }
  }

  /**
   * True when this device's Claude CLI still has the session's transcript on
   * disk, so resuming it here will work. A chat started on another machine
   * syncs its markdown note (and session id) but not the jsonl, so this
   * returns false and Recent Chats hides the otherwise-dead row.
   */
  async sessionExistsLocally(params: { sessionId: SessionId; cwd: string }): Promise<boolean> {
    try {
      const { access } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      await access(await this.claudeTranscriptPath(params.sessionId, params.cwd));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Path of the Claude CLI session record at
   * `<config>/projects/<encoded-cwd>/<sessionId>.jsonl`. `CLAUDE_CONFIG_DIR` is
   * resolved with the SAME precedence the SDK is spawned with (`env overrides`
   * > managed env > `process.env`), and the project dir is the cwd with every
   * non-alphanumeric character replaced by `-`, matching the CLI's encoding.
   */
  private async claudeTranscriptPath(sessionId: string, cwd: string): Promise<string> {
    const path = requireNodeModule<typeof import("node:path")>("path");
    const configDir = (await this.resolveClaudeConfigDir()).trim();
    const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    return path.join(configDir, "projects", projectDir, `${sessionId}.jsonl`);
  }

  private resolvedConfigDir: string | null = null;

  /**
   * The Claude config dir the spawned SDK actually uses: env overrides win
   * over managed env, which win over the ambient `process.env`, falling back
   * to `~/.claude`. Mirrors the `options.env` layering in {@link prompt}.
   *
   * Memoized after the first success: the config dir is fixed for a process's
   * lifetime, and resolving it awaits `getManagedEnv`, which may decrypt the
   * Plus license key — needless to repeat per entry when the history list
   * probes many sessions. A failure isn't cached, so a transient env error
   * retries.
   */
  private async resolveClaudeConfigDir(): Promise<string> {
    if (this.resolvedConfigDir !== null) return this.resolvedConfigDir;
    const os = requireNodeModule<typeof import("node:os")>("os");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const envOverrides = this.opts.getEnvOverrides?.() ?? {};
    const managedEnv = (await this.opts.getManagedEnv?.()) ?? {};
    this.resolvedConfigDir =
      envOverrides.CLAUDE_CONFIG_DIR ||
      managedEnv.CLAUDE_CONFIG_DIR ||
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(os.homedir(), ".claude");
    return this.resolvedConfigDir;
  }

  /**
   * Rehydrate a previously-persisted SDK session. Registers a `SessionState`
   * entry keyed by `params.sessionId` with `firstPromptStarted: true` so the
   * next `prompt()` passes `resume: <sessionId>` to the SDK, which loads the
   * prior conversation from `~/.claude/projects/.../<sessionId>.jsonl`.
   *
   * No SDK roundtrip happens here — the SDK only reads the on-disk transcript
   * lazily on the next `query()`. If the file is missing (Claude wiped state,
   * different machine), the next prompt fails; we let that surface as a normal
   * turn error rather than blocking the load.
   */
  async resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    logSdkOutbound(
      "resumeSession",
      { cwd: params.cwd, projectId: params.projectId ?? null },
      params.sessionId
    );
    await this.ensureCompatible();
    const cwd = params.cwd ?? null;
    const catalog = await this.ensureModelCatalog();
    const defaultId = this.opts.getDefaultModelId?.();
    const seedModelId = resolveSeedModelId(catalog, defaultId);

    this.sessions.set(params.sessionId, {
      cwd,
      projectId: params.projectId,
      firstPromptStarted: true,
      model: seedModelId,
      additionalDirectories: params.additionalDirectories,
      systemPromptAppend: this.resolveSystemPromptAppend(),
      claudeTaskPlan: createClaudeTaskPlanState(),
      backgroundTasks: new ClaudeBackgroundTaskStateMachine(),
    });

    const state = this.computeState(params.sessionId);
    logSdkOutboundResult(
      "resumeSession",
      { currentModelId: seedModelId ?? null, hasEffort: state.model !== null },
      params.sessionId
    );
    return { sessionId: params.sessionId, state };
  }

  async loadSession(_params: LoadSessionInput): Promise<LoadSessionOutput> {
    // The Claude SDK has no equivalent of ACP's `session/load` (which replays
    // a transcript provided by the caller). The loader falls back to
    // `resumeSession`, which reads the SDK's own on-disk transcript.
    throw new MethodUnsupportedError("session/load");
  }

  /**
   * The SDK's `options.additionalDirectories` is a stable option (`sdk.d.ts`),
   * so the Claude backend always honors widened roots — no capability probe is
   * needed (unlike the ACP backends, which gate on an experimental wire field).
   */
  supportsAdditionalDirectories(): boolean {
    return true;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      const q = session.active;
      if (!q) continue;
      try {
        await q.interrupt();
      } catch (e) {
        logWarn("[AgentMode] interrupt during shutdown threw", e);
      }
    }
    this.sessions.clear();
    this.sessionHandlers.clear();
    this.pendingUpdates.clear();
    for (const fn of this.exitListeners) {
      try {
        fn();
      } catch (e) {
        logWarn("[AgentMode] SDK exit listener threw", e);
      }
    }
    this.exitListeners.clear();
  }

  /**
   * Resolve the SDK's model catalog. Falls back to an on-demand probe
   * only when the shared cache is cold; at most one subprocess is
   * spawned per backend lifetime (deduped via `cachedModelsProbe`).
   * Failures resolve to `[]` so callers degrade gracefully.
   */
  private ensureModelCatalog(): Promise<ModelInfo[]> {
    if (this.cachedModels) return Promise.resolve(this.cachedModels);
    const envOverrides = this.opts.getEnvOverrides?.();
    const fromCache = getCachedSdkCatalog(envOverrides);
    if (fromCache && fromCache.length > 0) {
      this.cachedModels = fromCache;
      return Promise.resolve(fromCache);
    }
    if (this.cachedModelsProbe) return this.cachedModelsProbe;
    const probePromise = probeClaudeSdkCatalog(
      this.opts.pathToClaudeCodeExecutable,
      envOverrides
    ).then((models) => {
      if (models.length > 0) this.cachedModels = models;
      else this.cachedModelsProbe = null;
      return models;
    });
    this.cachedModelsProbe = probePromise;
    return probePromise;
  }

  private ensureCompatible(): Promise<void> {
    if (this.compatibilityConfirmed || !this.opts.checkCompatibility) return Promise.resolve();
    if (this.compatibilityProbe) return this.compatibilityProbe;
    const probe = this.opts.checkCompatibility().then(
      () => {
        this.compatibilityConfirmed = true;
        this.compatibilityProbe = null;
      },
      (error: unknown) => {
        this.compatibilityProbe = null;
        throw error;
      }
    );
    this.compatibilityProbe = probe;
    return probe;
  }

  private computeState(sessionId: SessionId): BackendState {
    const session = this.sessions.get(sessionId);
    const catalog = this.cachedModels ?? [];
    const seedModel = session?.model;
    const models: RawModelState | null =
      catalog.length > 0 && seedModel
        ? {
            currentModelId: seedModel,
            availableModels: catalog.map((m) => ({
              modelId: m.value,
              name: m.displayName,
              description: m.description,
            })),
          }
        : null;
    const modes: RawModeState = {
      ...STATIC_SDK_MODES,
      currentModeId: session?.permissionMode ?? STATIC_SDK_MODES.currentModeId,
      availableModes: [...STATIC_SDK_MODES.availableModes],
    };
    const modelInfo = seedModel ? catalog.find((m) => m.value === seedModel) : undefined;
    const effortOpt = synthesizeEffortConfigOption(modelInfo, session?.effort);
    const configOptions: BackendConfigOption[] | null = effortOpt ? [effortOpt] : null;
    return translateBackendState({ models, modes, configOptions }, this.opts.descriptor);
  }

  private dispatchStateChanged(sessionId: SessionId, state: BackendState): void {
    this.dispatchEvent({
      sessionId,
      update: { sessionUpdate: "state_changed", state },
    });
  }

  /**
   * Ask the live query for the account's plan-cap utilization and publish what it says.
   *
   * A read that failed changes nothing — we learned nothing about the account, so the
   * last good snapshot stands rather than blanking a meter the user is reading. A read
   * that succeeded and reported no caps is different: it means this session is not
   * metered by plan limits (an API-key, Bedrock, or Vertex login), so any caps on screen
   * describe an account the user is no longer on and are cleared
   * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
   *
   * The answer goes to every live session, not to the one that prompted the read: the
   * caps belong to the account, so they are equally true of every open chat, and routing
   * them to one would leave the others showing a stale number until they each ran a turn.
   */
  private async refreshPlanUsage(query: unknown): Promise<void> {
    const reading = await readClaudePlanUsage(query);
    if (this.shuttingDown || reading.kind === "unavailable") return;
    this.lastPlanUsage = reading.kind === "usage" ? reading.planUsage : null;
    for (const sessionId of this.sessionHandlers.keys()) {
      this.dispatchEvent({
        sessionId,
        update: { sessionUpdate: "plan_usage_update", planUsage: this.lastPlanUsage },
      });
    }
  }

  private dispatchEvent(event: SessionEvent): void {
    const handler = this.sessionHandlers.get(event.sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(event.sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(event.sessionId, queue);
      }
      if (queue.length >= ClaudeSdkBackendProcess.PENDING_UPDATE_LIMIT) {
        const kind = event.update.sessionUpdate;
        logWarn(
          `[AgentMode] dropping SDK event for ${event.sessionId}: pending buffer full (${queue.length}, kind=${kind})`
        );
        return;
      }
      queue.push(event);
      return;
    }
    try {
      handler(event);
    } catch (e) {
      logError(`[AgentMode] SDK event handler threw for ${event.sessionId}`, e);
    }
  }
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: AnthropicImageMediaType; data: string };
    };

type AnthropicImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Normalize image media types to the exact set Anthropic accepts for base64
 * image sources. Returns null for image types the SDK request cannot carry.
 */
function normalizeAnthropicImageMediaType(mimeType: string): AnthropicImageMediaType | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (
    normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/gif" ||
    normalized === "image/webp"
  ) {
    return normalized;
  }
  return null;
}

/**
 * Map a `PromptInput` to the `MessageParam.content` shape the Claude Agent
 * SDK forwards to Anthropic. Returns a plain string when the prompt is pure
 * text (the SDK accepts either, and the string form keeps the prior wire
 * shape for text-only turns) and a content-block array otherwise.
 */
export function promptInputToAnthropicContent(req: PromptInput): string | AnthropicContentBlock[] {
  const hasNonText = req.prompt.some((b) => b.type !== "text");
  if (!hasNonText) {
    const parts: string[] = [];
    for (const block of req.prompt) {
      if (block.type === "text" && block.text.length > 0) parts.push(block.text);
    }
    return parts.join("\n");
  }

  const blocks: AnthropicContentBlock[] = [];
  for (const block of req.prompt) {
    if (block.type === "text") {
      if (block.text.length > 0) blocks.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const mediaType = normalizeAnthropicImageMediaType(block.mimeType);
      if (!mediaType) {
        logWarn(`[AgentMode] unsupported image media type for Claude SDK: ${block.mimeType}`);
        blocks.push({
          type: "text",
          text: `[Unsupported image attachment omitted: ${block.mimeType}]`,
        });
        continue;
      }
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: block.data },
      });
    } else {
      // resource_link — we don't currently emit these from buildPromptBlocks,
      // but render a defensive textual reference so anything that slips
      // through is at least visible to the model.
      blocks.push({
        type: "text",
        text: `[Attached resource: ${block.name ?? block.uri}]`,
      });
    }
  }
  return blocks;
}

/** Short log summary that elides base64 image payloads. */
function summarizePromptContent(content: string | AnthropicContentBlock[]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "image"
      ? { type: "image", media_type: b.source.media_type, dataLength: b.source.data.length }
      : b
  );
}

async function* makePromptStream(
  content: string | AnthropicContentBlock[],
  sessionId: SessionId
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    // SDK's MessageParam accepts `string | Array<ContentBlockParam>`.
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

function canonicalModeToSdk(modeId: string): PermissionMode | null {
  switch (modeId) {
    case "default":
    case "acceptEdits":
    case "auto":
    case "bypassPermissions":
    case "plan":
      return modeId;
    default:
      return null;
  }
}
