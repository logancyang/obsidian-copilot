import { isCompactCommand } from "@/commands/compactCommand";
import { logError, logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";
import {
  query,
  type EffortLevel,
  type HookCallback,
  type ModelInfo,
  type Options,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import { readClaudePlanUsage } from "./claudePlanUsage";
import { withoutExpiredWindows } from "@/agentMode/session/planUsage";
import type {
  PlanUsage,
  BackendConfigOption,
  BackendDescriptor,
  BackendProcess,
  RawModelState,
  RawModeState,
  AgentMcpServer,
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
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
  StopTaskInput,
  WithdrawInput,
} from "@/agentMode/session/types";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import { AuthRequiredError, MethodUnsupportedError } from "@/agentMode/session/errors";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { createClaudeTaskPlanState, type ClaudeTaskPlanState } from "./claudeTodoPlan";
import { ClaudeLiveQuery } from "./claudeLiveQuery";
import {
  createTranslatorState,
  replayClaudeTranscript,
  type TranslatorState,
} from "./sdkMessageTranslator";
import { PermissionBridge, type AskUserQuestionPrompter } from "./permissionBridge";
import {
  getCachedSdkCatalog,
  probeClaudeSdkCatalog,
  resolveSeedModelId,
  synthesizeEffortConfigOption,
} from "./effortOption";
import { logSdkError, logSdkOutbound, logSdkOutboundResult } from "./sdkDebugTap";

interface SessionState {
  cwd: string | null;
  projectId?: ProjectScopeId;
  hasTranscript: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  thinking?: boolean;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
  translator: TranslatorState;
  live?: ClaudeLiveQuery;
  starting?: Promise<ClaudeLiveQuery>;
  systemPromptAppend: string;
}

// Every subagent runs in the background, even one the model asks to wait on: the chat lists it as a task and its report starts a reply, so the chat never blocks on it. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
export const runSubagentsInBackground: HookCallback = async (input) => {
  if (
    input.hook_event_name !== "PreToolUse" ||
    (input.tool_name !== "Agent" && input.tool_name !== "Task")
  ) {
    return {};
  }
  const toolInput =
    typeof input.tool_input === "object" &&
    input.tool_input !== null &&
    !Array.isArray(input.tool_input)
      ? (input.tool_input as Record<string, unknown>)
      : {};
  if (toolInput.run_in_background === true) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, run_in_background: true },
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

const THINKING_BUDGET_TOKENS = 31_999;

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
      hasTranscript: false,
      model: seedModelId,
      mcpServers: params.mcpServers,
      systemPromptAppend: this.resolveSystemPromptAppend(),
      translator: createTranslatorState(),
    });

    const state = this.computeState(sessionId);
    logSdkOutboundResult(
      "newSession",
      { sessionId, currentModelId: seedModelId ?? null, hasEffort: state.model !== null },
      sessionId
    );
    return { sessionId, state };
  }

  async prompt(params: PromptInput): Promise<void> {
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
    const live = await this.ensureLiveQuery(params.sessionId, session);
    await this.applyThinkingSetting(session, live);
    if (typeof messageContent === "string" && isCompactCommand(messageContent)) {
      session.translator.compactionTrigger = "manual";
    }
    logSdkOutbound(
      "prompt",
      {
        promptId: params.promptId,
        prompt: summarizePromptContent(messageContent),
        ...(params.interrupt ? { interrupt: true } : {}),
      },
      params.sessionId
    );
    live.push(params.promptId, messageContent, params.interrupt === true);
  }

  // One query serves the whole chat, so background tasks outlive the turn that launched them.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  private ensureLiveQuery(sessionId: SessionId, session: SessionState): Promise<ClaudeLiveQuery> {
    if (session.live) return Promise.resolve(session.live);
    session.starting ??= this.startLiveQuery(sessionId, session).finally(() => {
      session.starting = undefined;
    });
    return session.starting;
  }

  // The query outlives the toggle, so each prompt brings it up to date; a positive budget turns thinking on whether the query started with it or not. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  private async applyThinkingSetting(session: SessionState, live: ClaudeLiveQuery): Promise<void> {
    const thinking = Boolean(this.opts.getEnableThinking?.());
    if (session.thinking === thinking) return;
    await live.query.setMaxThinkingTokens(
      thinking ? THINKING_BUDGET_TOKENS : 0,
      thinking ? "summarized" : undefined
    );
    session.thinking = thinking;
  }

  private async startLiveQuery(
    sessionId: SessionId,
    session: SessionState
  ): Promise<ClaudeLiveQuery> {
    // Settings are read after the last await, so a change made while the query starts still reaches it. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    const managedEnv = (await this.opts.getManagedEnv?.()) ?? {};
    const permissionBridge = new PermissionBridge(sessionId, {
      getPrompter: () => this.permissionPrompter,
      getAskUserQuestionPrompter: () => this.askUserQuestionPrompter,
      isPlanModePlanFilePath: this.opts.isPlanModePlanFilePath,
      getIsReadOnlySession: () => this.isReadOnlySession,
    });

    const options: Options = {
      pathToClaudeCodeExecutable: this.opts.pathToClaudeCodeExecutable,
      cwd: session.cwd ?? undefined,
      includePartialMessages: true,
      // Edit tools stay out so the permission mode decides them. https://github.com/Brevilabs/obsidian-copilot-private/issues/690
      allowedTools: ["Read", "Glob", "Grep", "LS"],
      canUseTool: permissionBridge.canUseTool,
      // Claude's default skips every AGENTS.md below any CLAUDE.md. https://github.com/logancyang/obsidian-copilot/issues/3662
      settings: {
        pluginConfigs: {
          "agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } },
        },
      },
      // Each prompt's echo reports when it reaches Claude. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
      extraArgs: { "replay-user-messages": null },
      // Stop ends the main turn only; background agents keep running. https://github.com/Brevilabs/obsidian-copilot-private/issues/748
      perTaskStopAffordance: true,
      hooks: { PreToolUse: [{ hooks: [runSubagentsInBackground] }] },
    };
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      append: session.systemPromptAppend || undefined,
    };
    if (session.hasTranscript) {
      options.resume = sessionId;
    } else {
      options.sessionId = sessionId;
    }
    if (session.model) options.model = session.model;
    if (session.permissionMode) options.permissionMode = session.permissionMode;
    if (session.effort) options.effort = session.effort;
    if (session.mcpServers?.length) {
      options.mcpServers = Object.fromEntries(
        session.mcpServers.map((server) => [
          server.name,
          { type: "http" as const, url: server.url, headers: { ...server.headers } },
        ])
      );
      options.allowedTools = [
        ...(options.allowedTools ?? []),
        ...session.mcpServers.map((server) => `mcp__${server.name}`),
      ];
    }
    session.thinking = Boolean(this.opts.getEnableThinking?.());
    options.thinking = session.thinking
      ? { type: "adaptive", display: "summarized" }
      : { type: "disabled" };
    const envOverrides = this.opts.getEnvOverrides?.();
    const extraEnv = { ...managedEnv, ...envOverrides };
    if (Object.keys(extraEnv).length > 0) {
      options.env = { ...process.env, ...extraEnv };
    }

    if (this.sessions.get(sessionId) !== session) {
      throw new Error(`Session ${sessionId} closed before its prompt was sent`);
    }
    logSdkOutbound(
      "query",
      {
        resume: options.resume ?? null,
        sessionIdSeed: options.sessionId ?? null,
        model: options.model ?? null,
        permissionMode: options.permissionMode ?? null,
        effort: options.effort ?? null,
        allowedTools: options.allowedTools,
      },
      sessionId
    );
    const live: ClaudeLiveQuery = new ClaudeLiveQuery({
      sessionId,
      start: (input) => query({ prompt: input, options }),
      translator: session.translator,
      emit: (event) => this.dispatchEvent(event),
      onTurnStarted: (q) => void this.refreshPlanUsage(q),
      onSignedOut: () => {
        this.authConfirmed = false;
      },
      onEnded: () => {
        if (session.live === live) session.live = undefined;
      },
    });
    session.live = live;
    session.hasTranscript = true;
    return live;
  }

  async closeSession(params: { sessionId: SessionId }): Promise<void> {
    // Interrupt alone leaves the query's process alive. https://github.com/Brevilabs/obsidian-copilot-private/issues/429
    this.sessions.get(params.sessionId)?.live?.close();
    this.sessions.delete(params.sessionId);
    this.pendingUpdates.delete(params.sessionId);
  }

  async cancel(params: CancelInput): Promise<void> {
    logSdkOutbound("cancel", {}, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    const live = session?.live ?? (await session?.starting?.catch(() => undefined));
    if (!live) return;
    try {
      await live.interrupt();
    } catch (e) {
      logWarn("[AgentMode] SDK query.interrupt() threw", e);
      logSdkError("→", "interrupt", { error: err2String(e) }, params.sessionId);
    }
  }

  async withdraw(params: WithdrawInput): Promise<boolean> {
    logSdkOutbound("withdraw", { promptId: params.promptId }, params.sessionId);
    const live = this.sessions.get(params.sessionId)?.live;
    return live ? live.cancelQueued(params.promptId) : false;
  }

  async stopTask(params: StopTaskInput): Promise<void> {
    logSdkOutbound("stopTask", { taskId: params.taskId }, params.sessionId);
    await this.sessions.get(params.sessionId)?.live?.query.stopTask(params.taskId);
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    logSdkOutbound("setSessionModel", { modelId: params.modelId }, params.sessionId);
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    // The query outlives this call, so a change it refuses must not show as applied. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    await session.live?.query.setModel(params.modelId);
    session.model = params.modelId;
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
    await session.live?.query.setPermissionMode(mode);
    session.permissionMode = mode;
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
    const effort = params.value as EffortLevel;
    await session.live?.query.applyFlagSettings({ effortLevel: effort });
    session.effort = effort;
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
    return this.reopenSession("resumeSession", params, createClaudeTaskPlanState());
  }

  async loadSession(params: LoadSessionInput): Promise<LoadSessionOutput> {
    // Resuming a transcript this device lacks fails every later prompt, so the chat must start fresh.
    // https://github.com/logancyang/obsidian-copilot/issues/3643
    if (!(await this.sessionExistsLocally(params))) {
      throw new Error(`Claude transcript not found for session ${params.sessionId}`);
    }
    const claudeTaskPlan = createClaudeTaskPlanState();
    const opened = await this.reopenSession("loadSession", params, claudeTaskPlan);
    const transcript = await this.readTranscript(params.sessionId, params.cwd);
    for (const event of replayClaudeTranscript(transcript, params.sessionId, claudeTaskPlan)) {
      this.dispatchEvent(event);
    }
    return opened;
  }

  private async reopenSession(
    method: "resumeSession" | "loadSession",
    params: ResumeSessionInput,
    claudeTaskPlan: ClaudeTaskPlanState
  ): Promise<ResumeSessionOutput> {
    logSdkOutbound(
      method,
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
      hasTranscript: true,
      model: seedModelId,
      mcpServers: params.mcpServers,
      systemPromptAppend: this.resolveSystemPromptAppend(),
      translator: createTranslatorState(claudeTaskPlan),
    });

    const state = this.computeState(params.sessionId);
    logSdkOutboundResult(
      method,
      { currentModelId: seedModelId ?? null, hasEffort: state.model !== null },
      params.sessionId
    );
    return { sessionId: params.sessionId, state };
  }

  private async readTranscript(sessionId: SessionId, cwd: string): Promise<string> {
    try {
      const { readFile } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      return await readFile(await this.claudeTranscriptPath(sessionId, cwd), "utf8");
    } catch (err) {
      // An unreadable transcript still reopens the chat, empty, so the user can keep talking to it. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
      logWarn(`[AgentMode] could not read Claude transcript for ${sessionId}`, err);
      return "";
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) session.live?.close();
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
