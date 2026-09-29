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
  projectId?: ProjectScopeId;
  firstPromptStarted: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  additionalDirectories?: string[];
  claudeTaskPlan: ClaudeTaskPlanState;
  backgroundTasks: ClaudeBackgroundTaskStateMachine;
  active?: Query;
  systemPromptAppend: string;
}

const FOREGROUND_ONLY_TOOLS = new Set(["Agent", "Task", "Bash"]);
const REMOTE_AGENT_DENIAL_REASON =
  "Remote-isolated agents require background execution, which is temporarily unavailable in Copilot v4.";

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
  getEnableThinking?: () => boolean;
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  getDefaultModelId?: () => string | undefined;
  getSystemPromptAppend?: () => string | undefined;
  getEnvOverrides?: () => Record<string, string> | undefined;
  getManagedEnv?: () => Promise<Readonly<Record<string, string>>>;
  checkAuth?: () => Promise<boolean>;
  checkCompatibility?: () => Promise<void>;
}

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

  private lastPlanUsage: PlanUsage | null = null;
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private readonly sessions = new Map<SessionId, SessionState>();
  private permissionPrompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private askUserQuestionPrompter: AskUserQuestionPrompter | null = null;
  private isReadOnlySession: ((sessionId: SessionId) => boolean) | null = null;
  private exitListeners = new Set<() => void>();
  private shuttingDown = false;
  private cachedModels: ModelInfo[] | null = null;
  private cachedModelsProbe: Promise<ModelInfo[]> | null = null;
  private authConfirmed = false;
  private compatibilityConfirmed = false;
  private compatibilityProbe: Promise<void> | null = null;

  constructor(private readonly opts: ClaudeSdkBackendProcessOptions) {
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

    if (this.opts.checkAuth && !this.authConfirmed) {
      if (await this.opts.checkAuth()) {
        this.authConfirmed = true;
      } else {
        throw new AuthRequiredError(
          "You're not signed in to Claude. Use the Sign in button above the chat box to continue."
        );
      }
    }

    const messageContent = promptInputToAnthropicContent(params);
    const promptStream = makePromptStream(messageContent, params.sessionId);
    const permissionBridge = new PermissionBridge(params.sessionId, {
      getPrompter: () => this.permissionPrompter,
      getAskUserQuestionPrompter: () => this.askUserQuestionPrompter,
      isPlanModePlanFilePath: this.opts.isPlanModePlanFilePath,
      getIsReadOnlySession: () => this.isReadOnlySession,
    });

    const options: Options = {
      pathToClaudeCodeExecutable: this.opts.pathToClaudeCodeExecutable,
      cwd: session.cwd ?? undefined,
      includePartialMessages: true,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "LS"],
      disallowedTools: ["TaskOutput", "Workflow", "Monitor"],
      canUseTool: permissionBridge.canUseTool,
    };
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      append: session.systemPromptAppend || undefined,
    };
    if (session.firstPromptStarted) {
      options.resume = params.sessionId;
    } else {
      options.sessionId = params.sessionId;
    }
    if (session.model) options.model = session.model;
    if (session.permissionMode) options.permissionMode = session.permissionMode;
    if (session.effort) options.effort = session.effort;
    if (session.additionalDirectories?.length) {
      options.additionalDirectories = session.additionalDirectories;
    }
    options.thinking = this.opts.getEnableThinking?.()
      ? { type: "adaptive", display: "summarized" }
      : { type: "disabled" };
    const envOverrides = this.opts.getEnvOverrides?.();
    const managedEnv = (await this.opts.getManagedEnv?.()) ?? {};
    const extraEnv = { ...managedEnv, ...envOverrides };
    if (Object.keys(extraEnv).length > 0) {
      options.env = { ...process.env, ...extraEnv };
    }

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

    const turnAbort = new AbortController();
    options.abortController = turnAbort;

    if (this.sessions.get(params.sessionId) !== session) return { stopReason: "cancelled" };
    const q = query({ prompt: promptStream, options });
    session.active = q;
    session.firstPromptStarted = true;
    const stream = guardSdkStreamStall(q, {
      abortController: turnAbort,
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
              this.authConfirmed = false;
            }
          }
          break;
        }
      }
    } finally {
      if (session.active === q) session.active = undefined;
    }

    if (resultErrorMessage) {
      logSdkError("→", "prompt", { error: resultErrorMessage }, params.sessionId);
      throw new Error(resultErrorMessage);
    }
    logSdkOutboundResult("prompt", { stopReason }, params.sessionId);
    return { stopReason };
  }

  async closeSession(params: { sessionId: SessionId }): Promise<void> {
    // Interrupt alone leaves the query's process alive. https://github.com/Brevilabs/obsidian-copilot-private/issues/429
    this.sessions.get(params.sessionId)?.active?.close();
    this.sessions.delete(params.sessionId);
    this.pendingUpdates.delete(params.sessionId);
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

  async sessionExistsLocally(params: { sessionId: SessionId; cwd: string }): Promise<boolean> {
    try {
      const { access } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      await access(await this.claudeTranscriptPath(params.sessionId, params.cwd));
      return true;
    } catch {
      return false;
    }
  }

  private async claudeTranscriptPath(sessionId: string, cwd: string): Promise<string> {
    const path = requireNodeModule<typeof import("node:path")>("path");
    const configDir = (await this.resolveClaudeConfigDir()).trim();
    const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    return path.join(configDir, "projects", projectDir, `${sessionId}.jsonl`);
  }

  private resolvedConfigDir: string | null = null;

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
    throw new MethodUnsupportedError("session/load");
  }

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
    if (session && modelInfo) session.effort = effortOpt?.currentValue as EffortLevel | undefined;
    const configOptions: BackendConfigOption[] | null = effortOpt ? [effortOpt] : null;
    return translateBackendState({ models, modes, configOptions }, this.opts.descriptor);
  }

  private dispatchStateChanged(sessionId: SessionId, state: BackendState): void {
    this.dispatchEvent({
      sessionId,
      update: { sessionUpdate: "state_changed", state },
    });
  }

  // A failed read keeps the last snapshot; a successful read with no caps (API-key, Bedrock,
  // Vertex) clears it. The result goes to every live session because the caps belong to the
  // account, not the chat. https://github.com/logancyang/obsidian-copilot-preview/issues/193
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
      blocks.push({
        type: "text",
        text: `[Attached resource: ${block.name ?? block.uri}]`,
      });
    }
  }
  return blocks;
}

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
