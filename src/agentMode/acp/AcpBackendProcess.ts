import { logError, logInfo, logWarn } from "@/logger";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionId as AcpSessionId,
  type SessionModeState,
  type SessionModelState,
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
  SessionId,
  SessionUpdateHandler as DomainSessionUpdateHandler,
} from "@/agentMode/session/types";
import { wrapStreamsForDebug } from "./debugTap";
import { AcpBackend } from "./types";
import {
  acpNotificationToEvents,
  acpPermissionRequestToPrompt,
  acpStateToBackendState,
  cancelInputToAcp,
  decisionToAcpResponse,
  listedSessionFromAcp,
  mcpServerSpecToAcp,
  promptContentToAcp,
  sessionIdFromAcp,
  sessionIdToAcp,
  stopReasonFromAcp,
} from "./wireTranslate";

/**
 * Capabilities the agent may or may not implement. Tracked in a single Set so
 * adding a new capability is one constant + one branch in the unsupported
 * handler instead of touching reset / probe / getter sites.
 */
export type AcpCapability =
  | "session/list"
  | "session/resume"
  | "session/load"
  | "session/set_model"
  | "session/set_mode"
  | "session/set_config_option"
  | "session/additional_directories"
  | "mcp/http"
  | "mcp/sse";

/**
 * Detect a JSON-RPC -32601 (method not found) error from the ACP SDK. The SDK
 * surfaces these as `RequestError` instances; we also tolerate plain objects
 * shaped like `{ code: number }` defensively.
 */
function isMethodNotFoundError(err: unknown): boolean {
  if (err instanceof RequestError) return err.code === JSONRPC_METHOD_NOT_FOUND;
  if (typeof err === "object" && err !== null && "code" in err) {
    return err.code === JSONRPC_METHOD_NOT_FOUND;
  }
  return false;
}

const COPILOT_CLIENT_NAME = "obsidian-copilot";

/**
 * Per-session bookkeeping for the latest known wire-shaped catalogs. We keep
 * these so that mid-session `current_mode_update` / `config_option_update`
 * notifications and per-dimension `setSession*` calls can produce a fresh
 * `BackendState` without having to refetch from the agent.
 */
interface SessionWireState {
  models: SessionModelState | null;
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[] | null;
}

/**
 * Return a copy of `options` with the `category:"model"` select's currentValue
 * set to `modelId`, or the input unchanged when there's no such option. Lets an
 * optimistic model switch be reflected for backends whose catalog lives in a
 * config option (opencode ≥ 1.15.13) rather than a dedicated `models` state.
 */
function updateModelConfigOptionValue(
  options: SessionConfigOption[] | null,
  modelId: string
): SessionConfigOption[] | null {
  if (!options) return options;
  return options.map((o) =>
    o.type === "select" && o.category === "model" ? { ...o, currentValue: modelId } : o
  );
}

/**
 * One-per-vault wrapper around an ACP-speaking subprocess. Owns the
 * `ClientSideConnection`, the `AcpProcessManager`, and the demultiplexer
 * that fans `session/update` notifications out to the right `AgentSession`.
 *
 * Lifecycle: `start()` exactly once, then any number of `newSession`/`prompt`
 * calls, finally `shutdown()`. All sessions on this backend share the
 * subprocess and die together if it exits.
 */
export class AcpBackendProcess implements BackendProcess {
  private process: AcpProcessManager | null = null;
  private connection: ClientSideConnection | null = null;
  private readonly domainHandlers = new Map<SessionId, DomainSessionUpdateHandler>();
  /**
   * Per-session FIFO of `session/update` notifications that arrived before a
   * handler was registered. Buffers the wire-shaped notification so we
   * translate at replay time (the destination handler is domain-typed).
   */
  private readonly pendingUpdates = new Map<SessionId, SessionNotification[]>();
  private static readonly PENDING_UPDATE_LIMIT = 32;
  private permissionPrompter: ((req: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private exitListeners = new Set<() => void>();
  private capabilities = new Map<AcpCapability, boolean>();
  private readonly sessionWireState = new Map<SessionId, SessionWireState>();
  // Tool-call ids first seen as a `todowrite`-titled call, so later
  // tool_call_updates for the same id keep synthesizing a plan update even
  // after opencode renames the title (e.g. "3 todos"). See wireTranslate's
  // todoToolPlanFromAcp. Keyed by session like every other per-session map on
  // this shared (per-backend) process — a single backend instance serves all
  // its sessions, so a bare Set would leak ids across sessions and grow
  // unbounded for the process lifetime. Pruned on session teardown + shutdown.
  private readonly todoToolCallIdsBySession = new Map<SessionId, Set<string>>();

  constructor(
    private readonly app: App,
    private readonly backend: AcpBackend,
    private readonly clientVersion: string,
    private readonly descriptor: BackendDescriptor
  ) {}

  /**
   * Spawn the subprocess and complete the ACP `initialize` handshake.
   * Idempotent: a second call while an existing connection is live is a
   * no-op.
   */
  async start(): Promise<void> {
    if (this.connection) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    const descriptor = await this.backend.buildSpawnDescriptor({
      vaultBasePath: adapter.getBasePath(),
    });

    const procOpts: AcpProcessManagerOptions = {
      command: descriptor.command,
      args: descriptor.args,
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
      this.permissionPrompter = null;
      this.capabilities.clear();
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
    this.connection = new ClientSideConnection(() => client, stream);

    try {
      const init = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: COPILOT_CLIENT_NAME,
          version: this.clientVersion,
        },
      });
      if (init.agentCapabilities?.sessionCapabilities?.list != null) {
        this.capabilities.set("session/list", true);
      }
      if (init.agentCapabilities?.sessionCapabilities?.resume != null) {
        this.capabilities.set("session/resume", true);
      }
      if (init.agentCapabilities?.loadSession === true) {
        this.capabilities.set("session/load", true);
      }
      if (init.agentCapabilities?.mcpCapabilities?.http === true) {
        this.capabilities.set("mcp/http", true);
      }
      if (init.agentCapabilities?.mcpCapabilities?.sse === true) {
        this.capabilities.set("mcp/sse", true);
      }
      // Experimental ACP capability: presence of the (possibly empty) object
      // means the agent honors `additionalDirectories` on session lifecycle
      // requests. codex 0.135 / opencode 1.2.27 don't advertise it, so they
      // receive no field. Gating here auto-enables future versions that do.
      if (init.agentCapabilities?.sessionCapabilities?.additionalDirectories != null) {
        this.capabilities.set("session/additional_directories", true);
      }
      logInfo(
        `[AgentMode] initialized backend ${this.backend.id} (negotiated protocol v${init.protocolVersion}, listSessions=${this.hasCapability("session/list")}, resumeSession=${this.hasCapability("session/resume")}, loadSession=${this.hasCapability("session/load")}, mcp.http=${this.hasCapability("mcp/http")}, mcp.sse=${this.hasCapability("mcp/sse")}, additionalDirectories=${this.hasCapability("session/additional_directories")})`
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

  registerSessionHandler(sessionId: SessionId, handler: DomainSessionUpdateHandler): () => void {
    this.domainHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const wire of buffered) {
        try {
          for (const event of acpNotificationToEvents(wire, this.todoToolCallIdsFor(sessionId)))
            handler(event);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered session/update threw for ${sessionId}`, e);
        }
      }
    }
    return () => {
      // Only tear down if THIS handler is still the registered one — a later
      // re-register for the same sessionId (resume/reconnect) must not have its
      // live tracker deleted by the stale unsubscribe.
      if (this.domainHandlers.get(sessionId) === handler) {
        this.domainHandlers.delete(sessionId);
        // Teardown (not per-turn): the handler is unregistered only when the
        // AgentSession disposes, so drop this session's todo-id tracker too.
        this.todoToolCallIdsBySession.delete(sessionId);
      }
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    const req: NewSessionRequest = {
      cwd: params.cwd,
      mcpServers: params.mcpServers.map(mcpServerSpecToAcp),
      ...this.additionalDirectoriesField(params.additionalDirectories),
    };
    const wireResp = await this.requireConnection().newSession(req);
    this.recordWireState(wireResp.sessionId, {
      models: wireResp.models ?? null,
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return {
      sessionId: sessionIdFromAcp(wireResp.sessionId),
      state: this.computeState(wireResp.sessionId),
    };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    const resp = await this.requireConnection().prompt({
      sessionId: sessionIdToAcp(params.sessionId),
      prompt: promptContentToAcp(params.prompt),
    });
    return { stopReason: stopReasonFromAcp(resp.stopReason) };
  }

  async cancel(params: CancelInput): Promise<void> {
    return this.requireConnection().cancel(cancelInputToAcp(params));
  }

  hasCapability(cap: AcpCapability): boolean {
    return this.capabilities.get(cap) === true;
  }

  supportsMcpTransport(transport: "http" | "sse"): boolean {
    return this.hasCapability(transport === "http" ? "mcp/http" : "mcp/sse");
  }

  supportsAdditionalDirectories(): boolean {
    return this.hasCapability("session/additional_directories");
  }

  // Extra searchable roots ride on every session-lifecycle request (new, resume,
  // load), but only when the agent advertises the experimental
  // `additionalDirectories` capability — resume/load re-establish the roots just
  // like `session/new`, so they must carry them too or a restored project chat
  // loses its off-vault context roots. Agents that don't advertise the capability
  // get no field at all; sending one they'll silently ignore would be misleading.
  // Empty/absent roots also send nothing, so non-project sessions stay untouched.
  private additionalDirectoriesField(roots: string[] | undefined): {
    additionalDirectories?: string[];
  } {
    return this.supportsAdditionalDirectories() && roots?.length
      ? { additionalDirectories: roots }
      : {};
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    await this.dispatchCapability("session/set_model", (c) =>
      c.unstable_setSessionModel({
        sessionId: sessionIdToAcp(params.sessionId),
        modelId: params.modelId,
      })
    );
    const wire = this.sessionWireState.get(params.sessionId);
    if (wire) {
      if (wire.models) {
        wire.models = { ...wire.models, currentModelId: params.modelId };
      } else {
        // No dedicated `models` state (opencode ≥ 1.15.13 exposes the catalog
        // only as a `category:"model"` config option). Update that option's
        // currentValue so `computeState` recomputes from the real catalog —
        // never fabricate an empty `models` state (that strands the picker on
        // a raw wire id with everything else "not offered by agent").
        wire.configOptions = updateModelConfigOptionValue(wire.configOptions, params.modelId);
      }
    }
    return this.computeState(params.sessionId);
  }

  isSetSessionModelSupported(): boolean | null {
    return this.capabilitySupported("session/set_model");
  }

  async setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
    await this.dispatchCapability("session/set_mode", (c) =>
      c.setSessionMode({
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
      c.setSessionConfigOption({
        sessionId: sessionIdToAcp(params.sessionId),
        configId: params.configId,
        value: params.value,
      })
    );
    const wire = this.sessionWireState.get(params.sessionId);
    if (wire) {
      wire.configOptions = resp.configOptions;
    }
    return this.computeState(params.sessionId);
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return this.capabilitySupported("session/set_config_option");
  }

  /**
   * Run an RPC gated by capability. Throws `MethodUnsupportedError` if the
   * capability is known unsupported (advertised off, or a previous -32601).
   * On a fresh -32601 reply, cache the negative result and rethrow.
   */
  private async dispatchCapability<T>(
    capability: AcpCapability,
    run: (c: ClientSideConnection) => Promise<T>,
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
      (c) => c.listSessions(params.cwd ? { cwd: params.cwd } : {}),
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
        c.resumeSession({
          sessionId: sessionIdToAcp(params.sessionId),
          cwd: params.cwd,
          mcpServers: params.mcpServers.map(mcpServerSpecToAcp),
          ...this.additionalDirectoriesField(params.additionalDirectories),
        }),
      { mustBeAdvertised: true }
    );
    this.recordWireState(sessionIdToAcp(params.sessionId), {
      models: wireResp.models ?? null,
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return {
      sessionId: params.sessionId,
      state: this.computeState(sessionIdToAcp(params.sessionId)),
    };
  }

  async loadSession(params: LoadSessionInput): Promise<LoadSessionOutput> {
    const wireResp = await this.dispatchCapability(
      "session/load",
      (c) =>
        c.loadSession({
          sessionId: sessionIdToAcp(params.sessionId),
          cwd: params.cwd,
          mcpServers: params.mcpServers.map(mcpServerSpecToAcp),
          ...this.additionalDirectoriesField(params.additionalDirectories),
        }),
      { mustBeAdvertised: true }
    );
    this.recordWireState(sessionIdToAcp(params.sessionId), {
      models: wireResp.models ?? null,
      modes: wireResp.modes ?? null,
      configOptions: wireResp.configOptions ?? null,
    });
    return {
      sessionId: params.sessionId,
      state: this.computeState(sessionIdToAcp(params.sessionId)),
    };
  }

  async shutdown(): Promise<void> {
    this.connection = null;
    this.domainHandlers.clear();
    this.pendingUpdates.clear();
    this.sessionWireState.clear();
    this.todoToolCallIdsBySession.clear();
    this.permissionPrompter = null;
    this.capabilities.clear();
    if (this.process) {
      try {
        await this.process.shutdown();
      } catch (e) {
        logError("[AgentMode] backend shutdown failed", e);
      }
      this.process = null;
    }
  }

  private requireConnection(): ClientSideConnection {
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

  /**
   * The todo-tool id tracker for one session, created on first use. Scoping it
   * per session keeps one session's `todowrite` ids from being honored for
   * another on this shared backend process (see the field's declaration).
   */
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
      models: null,
      modes: null,
      configOptions: null,
    };
    return acpStateToBackendState(wire.models, wire.modes, wire.configOptions, this.descriptor);
  }

  private routeSessionUpdate(acpSessionId: AcpSessionId, update: SessionNotification): void {
    const sessionId = sessionIdFromAcp(acpSessionId);
    // Mirror per-dimension wire updates into our cache so subsequent
    // setSession* calls (and the next `state_changed` event) reflect reality.
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

    // Per-dimension wire updates already mutated `wire` above; AgentSession
    // ignores them and waits for the synthesized `state_changed` we publish
    // below. Skip the original to avoid a wasted translation + dispatch.
    const sub = update.update.sessionUpdate;
    if (sub === "current_mode_update" || sub === "config_option_update") {
      handler({
        sessionId,
        update: { sessionUpdate: "state_changed", state: this.computeState(sessionId) },
      });
      return;
    }

    for (const event of acpNotificationToEvents(update, this.todoToolCallIdsFor(sessionId)))
      handler(event);
  }

  private async handlePermission(
    req: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    if (!this.permissionPrompter) {
      logWarn(`[AgentMode] permission requested but no prompter is registered; auto-cancelling`);
      return { outcome: { outcome: "cancelled" } };
    }
    const decision = await this.permissionPrompter(acpPermissionRequestToPrompt(req));
    return decisionToAcpResponse(decision);
  }
}
