import { logError, logInfo, logWarn } from "@/logger";
import {
  client as createClient,
  type ClientConnection,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionId as AcpSessionId,
  type SessionModeState,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter } from "obsidian";
import { AcpProcessManager, AcpProcessManagerOptions } from "./AcpProcessManager";
import { VaultClient } from "./VaultClient";
import { JSONRPC_METHOD_NOT_FOUND, MethodUnsupportedError } from "@/agentMode/session/errors";
import type {
  BackendDescriptor,
  BackendProcess,
  BackendState,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
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
  SessionUpdateHandler as DomainSessionUpdateHandler,
  SessionUsage,
} from "@/agentMode/session/types";
import { wrapStreamsForDebug } from "./debugTap";
import { formToQuestionPrompt } from "./elicitation";
import { AcpBackend } from "./types";
import {
  withoutExpiredWindows,
  type PlanUsage,
  type PlanUsageReading,
} from "@/agentMode/session/planUsage";
import {
  acpNotificationToEvents,
  acpPermissionRequestToPrompt,
  acpStateToBackendState,
  cancelInputToAcp,
  decisionToAcpResponse,
  listedSessionFromAcp,
  promptContentToAcp,
  sessionIdFromAcp,
  sessionIdToAcp,
  stopReasonFromAcp,
} from "./wireTranslate";

export type AcpCapability =
  | "session/close"
  | "session/list"
  | "session/resume"
  | "session/load"
  | "session/set_mode"
  | "session/set_config_option"
  | "session/additional_directories";

function isMethodNotFoundError(err: unknown): boolean {
  if (err instanceof RequestError) return err.code === JSONRPC_METHOD_NOT_FOUND;
  if (typeof err === "object" && err !== null && "code" in err) {
    return err.code === JSONRPC_METHOD_NOT_FOUND;
  }
  return false;
}

const COPILOT_CLIENT_NAME = "obsidian-copilot";
const JSONRPC_INTERNAL_ERROR = -32603;

interface SessionWireState {
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
}

export class AcpBackendProcess implements BackendProcess {
  private process: AcpProcessManager | null = null;
  private connection: ClientConnection | null = null;
  private readonly domainHandlers = new Map<SessionId, DomainSessionUpdateHandler>();
  private readonly pendingUpdates = new Map<SessionId, SessionNotification[]>();
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private permissionPrompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private askUserQuestionPrompter:
    | ((req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>)
    | null = null;
  private exitListeners = new Set<() => void>();
  private unhealthyHandler: (() => void) | null = null;
  // A service that is dead from spawn is reported, not restarted forever. https://github.com/Brevilabs/obsidian-copilot-private/issues/561
  private hasServedSession = false;
  private capabilities = new Map<AcpCapability, boolean>();
  private readonly sessionWireState = new Map<SessionId, SessionWireState>();
  private readonly todoToolCallIdsBySession = new Map<SessionId, Set<string>>();
  private readonly sawLiveUsage = new Set<SessionId>();
  private lastPlanUsage: PlanUsage | null = null;
  private planUsageRead: Promise<void> | null = null;
  private planUsageReadQueued = false;
  private readonly backendContextWindows = new Map<string, number>();

  constructor(
    private readonly app: App,
    private readonly backend: AcpBackend,
    private readonly clientVersion: string,
    private readonly descriptor: BackendDescriptor
  ) {}

  async start(): Promise<void> {
    if (this.connection) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const descriptor = await this.backend.buildSpawnDescriptor({
      vaultBasePath: adapter.getBasePath(),
      vaultName: this.app.vault.getName(),
    });

    const procOpts: AcpProcessManagerOptions = {
      command: descriptor.command,
      args: descriptor.args,
      cwd: descriptor.cwd,
      env: descriptor.env,
      logTag: this.backend.id,
    };
    const proc = new AcpProcessManager(procOpts);
    this.process = proc;
    const raw = proc.start();
    const { stdin, stdout } = wrapStreamsForDebug(raw.stdin, raw.stdout, this.backend.id);

    proc.onExit(() => {
      logWarn(`[AgentMode] backend ${this.backend.id} exited`);
      this.connection = null;
      this.domainHandlers.clear();
      this.pendingUpdates.clear();
      this.sessionWireState.clear();
      this.todoToolCallIdsBySession.clear();
      this.sawLiveUsage.clear();
      this.permissionPrompter = null;
      this.askUserQuestionPrompter = null;
      this.capabilities.clear();
      this.lastPlanUsage = null;
      this.planUsageReadQueued = false;
      this.backendContextWindows.clear();
      for (const fn of this.exitListeners) {
        try {
          fn();
        } catch (e) {
          logWarn("[AgentMode] exit listener threw", e);
        }
      }
    });

    const stream = ndJsonStream(stdin, stdout);
    const client = new VaultClient(this.app, {
      onSessionUpdate: (sessionId, update) => this.routeSessionUpdate(sessionId, update),
      requestPermission: (req) => this.handlePermission(req),
    });
    this.connection = createClient()
      .onRequest("fs/read_text_file", ({ params }) => client.readTextFile(params))
      .onRequest("fs/write_text_file", ({ params }) => client.writeTextFile(params))
      .onRequest("session/request_permission", ({ params }) => client.requestPermission(params))
      .onRequest("elicitation/create", ({ params, requestId, signal }) =>
        this.handleElicitation(params, String(requestId), signal)
      )
      .onNotification("session/update", ({ params }) => client.sessionUpdate(params))
      .connect(stream);

    try {
      const init = await this.connection.agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          elicitation: { form: {} },
          // Without this, codex-acp also streams the plan body as chat text, duplicating the
          // plan-approval card. https://github.com/Brevilabs/obsidian-copilot-private/issues/551
          plan: {},
        },
        clientInfo: {
          name: COPILOT_CLIENT_NAME,
          version: this.clientVersion,
        },
      });
      if (init.agentCapabilities?.sessionCapabilities?.close != null) {
        this.capabilities.set("session/close", true);
      }
      if (init.agentCapabilities?.sessionCapabilities?.list != null) {
        this.capabilities.set("session/list", true);
      }
      if (init.agentCapabilities?.sessionCapabilities?.resume != null) {
        this.capabilities.set("session/resume", true);
      }
      if (init.agentCapabilities?.loadSession === true) {
        this.capabilities.set("session/load", true);
      }
      if (init.agentCapabilities?.sessionCapabilities?.additionalDirectories != null) {
        this.capabilities.set("session/additional_directories", true);
      }
      logInfo(
        `[AgentMode] initialized backend ${this.backend.id} (negotiated protocol v${init.protocolVersion}, listSessions=${this.hasCapability("session/list")}, resumeSession=${this.hasCapability("session/resume")}, loadSession=${this.hasCapability("session/load")}, additionalDirectories=${this.hasCapability("session/additional_directories")})`
      );
    } catch (err) {
      logError(
        `[AgentMode] initialize failed for ${this.backend.id}; tearing down subprocess`,
        err
      );
      this.connection = null;
      try {
        await proc.shutdown();
      } catch (e) {
        logError("[AgentMode] shutdown after failed initialize threw", e);
      }
      this.process = null;
      throw err;
    }
  }

  isRunning(): boolean {
    return this.process?.isRunning() ?? false;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void {
    this.permissionPrompter = fn;
  }

  setAskUserQuestionPrompter(
    fn: (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void {
    this.askUserQuestionPrompter = fn;
  }

  setUnhealthyHandler(fn: () => void): void {
    this.unhealthyHandler = fn;
  }

  registerSessionHandler(sessionId: SessionId, handler: DomainSessionUpdateHandler): () => void {
    this.domainHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const wire of buffered) {
        try {
          const sub = wire.update.sessionUpdate;
          if (sub === "current_mode_update" || sub === "config_option_update") {
            handler({
              sessionId,
              update: { sessionUpdate: "state_changed", state: this.computeState(wire.sessionId) },
            });
            continue;
          }
          for (const event of acpNotificationToEvents(wire, this.todoToolCallIdsFor(sessionId)))
            handler(event);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered session/update threw for ${sessionId}`, e);
        }
      }
    }
    this.lastPlanUsage = this.lastPlanUsage && withoutExpiredWindows(this.lastPlanUsage);
    if (this.lastPlanUsage) {
      try {
        handler({
          sessionId,
          update: { sessionUpdate: "plan_usage_update", planUsage: this.planUsageFor(sessionId) },
        });
      } catch (e) {
        logWarn(`[AgentMode] replay of plan usage threw for ${sessionId}`, e);
      }
    } else {
      void this.refreshPlanUsage();
    }
    return () => {
      if (this.domainHandlers.get(sessionId) === handler) {
        this.domainHandlers.delete(sessionId);
        this.todoToolCallIdsBySession.delete(sessionId);
        this.sawLiveUsage.delete(sessionId);
      }
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    const req: NewSessionRequest = {
      cwd: params.cwd,
      mcpServers: [],
      ...this.additionalDirectoriesField(params.additionalDirectories),
    };
    const wireResp = await this.requireConnection()
      .agent.request("session/new", req)
      .catch(async (err: unknown) => {
        throw await this.serviceStoppedOr(err);
      });
    this.hasServedSession = true;
    this.recordWireState(wireResp.sessionId, {
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return {
      sessionId: sessionIdFromAcp(wireResp.sessionId),
      state: this.computeState(wireResp.sessionId),
    };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    const resp = await this.requireConnection()
      .agent.request("session/prompt", {
        sessionId: sessionIdToAcp(params.sessionId),
        prompt: promptContentToAcp(params.prompt),
      })
      .catch(async (err: unknown) => {
        throw await this.serviceStoppedOr(err);
      });
    this.hasServedSession = true;
    const usage = resp.usage;
    if (usage && !this.sawLiveUsage.has(params.sessionId)) {
      const handler = this.domainHandlers.get(params.sessionId);
      if (handler) {
        handler(
          this.withBackendContextWindow({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "usage_update",
              usage: {
                usedTokens: usage.totalTokens,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cachedReadTokens ?? undefined,
                cacheWriteTokens: usage.cachedWriteTokens ?? undefined,
                updatedAt: Date.now(),
              },
            },
          })
        );
      }
    }
    void this.refreshPlanUsage();
    return { stopReason: stopReasonFromAcp(resp.stopReason) };
  }

  // A failed read keeps the last snapshot; a successful read with no caps clears it. The result
  // goes to every attached session because the caps belong to the account, not the chat.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/193
  private refreshPlanUsage(): Promise<void> {
    if (!this.backend.readPlanUsage || !this.connection) return Promise.resolve();
    if (this.planUsageRead) {
      this.planUsageReadQueued = true;
      return this.planUsageRead;
    }
    this.planUsageRead = this.readAndPublishPlanUsage().finally(() => {
      this.planUsageRead = null;
      if (this.planUsageReadQueued) {
        this.planUsageReadQueued = false;
        void this.refreshPlanUsage();
      }
    });
    return this.planUsageRead;
  }

  private async readAndPublishPlanUsage(): Promise<void> {
    if (!this.backend.readPlanUsage) return;
    let reading: PlanUsageReading;
    try {
      reading = await this.backend.readPlanUsage();
    } catch (e) {
      logWarn(`[AgentMode] ${this.backend.id} plan usage read threw`, e);
      return;
    }
    if (!this.connection) return;
    if (reading.kind === "unavailable") return;
    this.lastPlanUsage = reading.kind === "usage" ? reading.planUsage : null;
    for (const [sessionId, handler] of this.domainHandlers) {
      try {
        handler({
          sessionId,
          update: { sessionUpdate: "plan_usage_update", planUsage: this.planUsageFor(sessionId) },
        });
      } catch (e) {
        logWarn(`[AgentMode] plan usage dispatch threw for ${sessionId}`, e);
      }
    }
  }

  private planUsageFor(sessionId: SessionId): PlanUsage | null {
    if (!this.lastPlanUsage) return null;
    const applies = this.backend.planUsageAppliesTo?.(this.currentWireModelId(sessionId)) ?? true;
    return applies ? this.lastPlanUsage : null;
  }

  private republishPlanUsage(sessionId: SessionId): void {
    if (!this.lastPlanUsage || !this.backend.planUsageAppliesTo) return;
    this.domainHandlers.get(sessionId)?.({
      sessionId,
      update: { sessionUpdate: "plan_usage_update", planUsage: this.planUsageFor(sessionId) },
    });
  }

  async closeSession(params: { sessionId: SessionId }): Promise<void> {
    await this.dispatchCapability(
      "session/close",
      (connection) => connection.agent.request("session/close", params),
      {
        mustBeAdvertised: true,
      }
    );
    this.sessionWireState.delete(params.sessionId);
    this.pendingUpdates.delete(params.sessionId);
  }

  async cancel(params: CancelInput): Promise<void> {
    return this.requireConnection().agent.notify("session/cancel", cancelInputToAcp(params));
  }

  hasCapability(cap: AcpCapability): boolean {
    return this.capabilities.get(cap) === true;
  }

  supportsAdditionalDirectories(): boolean {
    return this.hasCapability("session/additional_directories");
  }

  private additionalDirectoriesField(roots: string[] | undefined): {
    additionalDirectories?: string[];
  } {
    return this.supportsAdditionalDirectories() && roots?.length
      ? { additionalDirectories: roots }
      : {};
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    const option = this.sessionWireState
      .get(params.sessionId)
      ?.configOptions?.find((option) => option.type === "select" && option.category === "model");
    // Current agents expose model switching only through advertised config options. https://github.com/Brevilabs/obsidian-copilot-private/issues/550
    if (!option) throw new MethodUnsupportedError("session/set_config_option");
    return this.setSessionConfigOption({
      sessionId: params.sessionId,
      configId: option.id,
      value: params.modelId,
    });
  }

  isSetSessionModelSupported(): boolean | null {
    return this.isSetSessionConfigOptionSupported();
  }

  async setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
    await this.dispatchCapability("session/set_mode", (c) =>
      c.agent.request("session/set_mode", {
        sessionId: sessionIdToAcp(params.sessionId),
        modeId: params.modeId,
      })
    );
    const wire = this.sessionWireState.get(params.sessionId);
    if (wire) {
      const seed: SessionModeState = wire.modes ?? { availableModes: [], currentModeId: "" };
      wire.modes = { ...seed, currentModeId: params.modeId };
    }
    return this.computeState(params.sessionId);
  }

  isSetSessionModeSupported(): boolean | null {
    return this.capabilitySupported("session/set_mode");
  }

  async setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState> {
    const resp = await this.dispatchCapability("session/set_config_option", (c) =>
      c.agent.request("session/set_config_option", {
        sessionId: sessionIdToAcp(params.sessionId),
        configId: params.configId,
        value: params.value,
      })
    );
    const wire = this.sessionWireState.get(params.sessionId);
    if (wire) {
      wire.configOptions = resp.configOptions;
    }
    this.republishPlanUsage(params.sessionId);
    return this.computeState(params.sessionId);
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return this.capabilitySupported("session/set_config_option");
  }

  private async dispatchCapability<T>(
    capability: AcpCapability,
    run: (c: ClientConnection) => Promise<T>,
    opts: { mustBeAdvertised?: boolean } = {}
  ): Promise<T> {
    const known = this.capabilities.get(capability);
    if (known === false || (opts.mustBeAdvertised && known !== true)) {
      throw new MethodUnsupportedError(capability);
    }
    try {
      const resp = await run(this.requireConnection());
      this.capabilities.set(capability, true);
      return resp;
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        this.capabilities.set(capability, false);
        throw new MethodUnsupportedError(capability);
      }
      throw err;
    }
  }

  private capabilitySupported(capability: AcpCapability): boolean | null {
    return this.capabilities.has(capability) ? this.capabilities.get(capability)! : null;
  }

  async listSessions(params: ListSessionsInput): Promise<ListSessionsOutput> {
    const resp = await this.dispatchCapability(
      "session/list",
      (c) => c.agent.request("session/list", params.cwd ? { cwd: params.cwd } : {}),
      { mustBeAdvertised: true }
    );
    return {
      sessions: resp.sessions.map((s) =>
        listedSessionFromAcp({
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: (s as { title?: string | null }).title ?? null,
          updatedAt: (s as { updatedAt?: string | null }).updatedAt ?? null,
        })
      ),
    };
  }

  async resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    const wireResp = await this.dispatchCapability(
      "session/resume",
      (c) =>
        c.agent.request("session/resume", {
          sessionId: sessionIdToAcp(params.sessionId),
          cwd: params.cwd,
          mcpServers: [],
          ...this.additionalDirectoriesField(params.additionalDirectories),
        }),
      { mustBeAdvertised: true }
    );
    this.hasServedSession = true;
    this.recordWireState(sessionIdToAcp(params.sessionId), {
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return {
      sessionId: params.sessionId,
      state: this.computeState(sessionIdToAcp(params.sessionId)),
    };
  }

  async loadSession(params: LoadSessionInput): Promise<LoadSessionOutput> {
    const sessionId = params.sessionId;
    const wireResp = await this.dispatchCapability(
      "session/load",
      (c) =>
        c.agent.request("session/load", {
          sessionId: sessionIdToAcp(sessionId),
          cwd: params.cwd,
          mcpServers: [],
          ...this.additionalDirectoriesField(params.additionalDirectories),
        }),
      { mustBeAdvertised: true }
    );
    this.hasServedSession = true;
    this.recordWireState(sessionIdToAcp(sessionId), {
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return { sessionId, state: this.computeState(sessionIdToAcp(sessionId)) };
  }

  async shutdown(): Promise<void> {
    this.connection = null;
    this.domainHandlers.clear();
    this.pendingUpdates.clear();
    this.sessionWireState.clear();
    this.todoToolCallIdsBySession.clear();
    this.sawLiveUsage.clear();
    this.permissionPrompter = null;
    this.askUserQuestionPrompter = null;
    this.capabilities.clear();
    this.lastPlanUsage = null;
    this.backendContextWindows.clear();
    if (this.process) {
      try {
        await this.process.shutdown();
      } catch (e) {
        logError("[AgentMode] backend shutdown failed", e);
      }
      this.process = null;
    }
  }

  // OpenCode 2 leaves ACP alive when its private service dies, so the process must be replaced.
  // A process that never served a session is not replaced: its replacement would fail the same
  // way and restart forever. A healthy service reports some failures with the same error as a
  // dead one, so a failed `session/list` probe decides. https://github.com/Brevilabs/obsidian-copilot-private/issues/561
  // https://github.com/anomalyco/opencode/issues/51716
  private async serviceStoppedOr(err: unknown): Promise<unknown> {
    if (
      !(err instanceof RequestError && err.code === JSONRPC_INTERNAL_ERROR) ||
      !this.hasCapability("session/list")
    ) {
      return err;
    }
    const serviceAnswers = await this.requireConnection()
      .agent.request("session/list", {})
      .then(
        () => true,
        () => false
      );
    if (serviceAnswers) return err;
    if (!this.hasServedSession) {
      return new Error(
        `${this.backend.displayName}'s internal service failed to start. Check the Copilot log for its error.`
      );
    }
    this.unhealthyHandler?.();
    return new Error(`${this.backend.displayName}'s internal service stopped. Please try again.`);
  }

  private requireConnection(): ClientConnection {
    if (!this.connection) {
      throw new Error(
        this.process
          ? "AcpBackendProcess subprocess has exited"
          : "AcpBackendProcess.start() not called"
      );
    }
    return this.connection;
  }

  private recordWireState(sessionId: AcpSessionId, wire: SessionWireState): void {
    this.sessionWireState.set(sessionIdFromAcp(sessionId), wire);
  }

  private todoToolCallIdsFor(sessionId: SessionId): Set<string> {
    let ids = this.todoToolCallIdsBySession.get(sessionId);
    if (!ids) {
      ids = new Set<string>();
      this.todoToolCallIdsBySession.set(sessionId, ids);
    }
    return ids;
  }

  private computeState(sessionId: AcpSessionId): BackendState {
    const wire = this.sessionWireState.get(sessionIdFromAcp(sessionId)) ?? {
      modes: null,
      configOptions: null,
    };
    return acpStateToBackendState(wire.modes, wire.configOptions, this.descriptor);
  }

  private routeSessionUpdate(acpSessionId: AcpSessionId, update: SessionNotification): void {
    const sessionId = sessionIdFromAcp(acpSessionId);

    const wire = this.sessionWireState.get(sessionId);
    if (wire) {
      const u = update.update;
      if (u.sessionUpdate === "current_mode_update") {
        const seed = wire.modes ?? { availableModes: [], currentModeId: "" };
        wire.modes = { ...seed, currentModeId: u.currentModeId };
      } else if (u.sessionUpdate === "config_option_update") {
        wire.configOptions = u.configOptions;
      }
    }
    if (update.update.sessionUpdate === "usage_update") {
      this.sawLiveUsage.add(sessionId);
    }

    const handler = this.domainHandlers.get(sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(sessionId, queue);
      }
      if (queue.length >= AcpBackendProcess.PENDING_UPDATE_LIMIT) {
        const kind = update.update.sessionUpdate ?? "unknown";
        logWarn(
          `[AgentMode] dropping session/update for ${sessionId}: pending buffer full (${queue.length}, kind=${kind})`
        );
        return;
      }
      queue.push(update);
      return;
    }

    const sub = update.update.sessionUpdate;
    if (sub === "current_mode_update" || sub === "config_option_update") {
      handler({
        sessionId,
        update: { sessionUpdate: "state_changed", state: this.computeState(sessionId) },
      });
      if (sub === "config_option_update") this.republishPlanUsage(sessionId);
      return;
    }

    for (const event of acpNotificationToEvents(update, this.todoToolCallIdsFor(sessionId)))
      handler(this.withBackendContextWindow(event));
  }

  private withBackendContextWindow(event: SessionEvent): SessionEvent {
    if (!this.backend.readContextWindow) return event;
    if (event.update.sessionUpdate !== "usage_update") return event;
    const usage = event.update.usage;
    if (usage.contextWindow) return event;
    const wireModelId = this.currentWireModelId(event.sessionId);
    if (!wireModelId) return event;
    const known = this.backendContextWindows.get(wireModelId);
    if (known === undefined) {
      void this.resolveBackendContextWindow(event.sessionId, wireModelId, usage);
      return event;
    }
    return {
      sessionId: event.sessionId,
      update: { sessionUpdate: "usage_update", usage: { ...usage, contextWindow: known } },
    };
  }

  async readContextWindow(wireModelId: string | null | undefined): Promise<number | null> {
    if (!wireModelId || !this.backend.readContextWindow) return null;
    const known = this.backendContextWindows.get(wireModelId);
    if (known !== undefined) return known;
    let contextWindow: number | null;
    try {
      contextWindow = (await this.backend.readContextWindow(wireModelId)) ?? null;
    } catch (e) {
      logWarn(`[AgentMode] ${this.backend.id} context window read threw for ${wireModelId}`, e);
      return null;
    }
    if (contextWindow) this.backendContextWindows.set(wireModelId, contextWindow);
    return contextWindow;
  }

  private async resolveBackendContextWindow(
    sessionId: SessionId,
    wireModelId: string,
    usage: SessionUsage
  ): Promise<void> {
    const contextWindow = await this.readContextWindow(wireModelId);
    if (!contextWindow) return;
    if (this.currentWireModelId(sessionId) !== wireModelId) return;
    this.domainHandlers.get(sessionId)?.({
      sessionId,
      update: { sessionUpdate: "usage_update", usage: { ...usage, contextWindow } },
    });
  }

  private currentWireModelId(sessionId: SessionId): string | null {
    const wire = this.sessionWireState.get(sessionId);
    if (!wire) return null;
    for (const option of wire.configOptions ?? []) {
      if (option.type === "select" && option.category === "model" && option.currentValue) {
        return option.currentValue;
      }
    }
    return null;
  }

  private async handlePermission(
    req: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    if (!this.permissionPrompter) {
      logWarn(`[AgentMode] permission requested but no prompter is registered; auto-cancelling`);
      return { outcome: { outcome: "cancelled" } };
    }
    const decision = await this.permissionPrompter(
      acpPermissionRequestToPrompt(
        req,
        (option, metadata) => this.descriptor.presentPermissionOption?.(option, metadata) ?? option
      )
    );
    return decisionToAcpResponse(decision);
  }

  private async handleElicitation(
    request: CreateElicitationRequest,
    requestId: string,
    signal: AbortSignal
  ): Promise<CreateElicitationResponse> {
    const form = formToQuestionPrompt(request, requestId);
    if (!form) return { action: "decline" };
    if (!this.askUserQuestionPrompter) return { action: "cancel" };
    const answers = await this.askUserQuestionPrompter({ ...form.prompt, signal });
    if (Object.keys(answers).length === 0) return { action: "cancel" };
    return { action: "accept", content: form.toContent(answers) };
  }
}
