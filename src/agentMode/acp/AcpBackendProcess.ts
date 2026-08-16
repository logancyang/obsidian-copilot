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
  SessionEvent,
  SessionId,
  SessionUpdateHandler as DomainSessionUpdateHandler,
  SessionUsage,
} from "@/agentMode/session/types";
import { wrapStreamsForDebug } from "./debugTap";
import { AcpBackend } from "./types";
import {
  withoutExpiredWindows,
  type PlanUsage,
  type PlanUsageReading,
} from "@/agentMode/session/planUsage";
import {
  consumeReplayUpdate,
  createReplayTranscriptState,
  finishReplayTranscript,
  type ReplayTranscriptState,
} from "./replayTranscript";
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
  | "session/additional_directories";

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
  // Sessions that pushed at least one live `usage_update` notification. Its
  // `used` is current context occupancy; the prompt-result `usage.totalTokens`
  // is a cumulative session total. Once a live update has been seen we suppress
  // the coarser prompt-result fallback so it can't overwrite occupancy with the
  // cumulative figure. Keyed by session like the other per-session maps; pruned
  // on session teardown + shutdown.
  private readonly sawLiveUsage = new Set<SessionId>();
  // Replay accumulators, one per in-flight `loadSession`. A `session/update`
  // for a session with an active accumulator is fed to it instead of being
  // routed, which is what keeps the replay burst clear of `pendingUpdates` and
  // its PENDING_UPDATE_LIMIT — a real transcript easily exceeds 32 frames.
  //
  // DESIGN NOTE — deliberately unbounded. A replay is bounded by the
  // conversation the user is reopening, and the Claude adapter already reads a
  // whole session jsonl into memory the same way (`readPersistedTranscript`).
  // Capping it would truncate exactly the long histories this exists to
  // restore, and no measurement suggests the size is a problem. If a future
  // review flags this again, point them at this note.
  private readonly loadSessionCollectors = new Map<SessionId, ReplayTranscriptState>();
  /**
   * Last plan-cap snapshot read from the backend.
   *
   * The caps belong to the account, not to a conversation, so one session's reading is
   * true for every other. Held process-wide and replayed on attach, a new or switched
   * chat shows the caps immediately instead of blanking until its own first turn.
   */
  private lastPlanUsage: PlanUsage | null = null;
  /**
   * The in-flight plan-usage read, when one is running. Reads are strictly sequential:
   * a trigger that arrives mid-read joins it instead of racing it — overlapping reads
   * can resolve out of start order and roll the meters backward, and several chats
   * attaching at once would otherwise fire one identical account read each — and sets
   * {@link planUsageReadQueued} so exactly one follow-up read runs afterwards, because
   * a turn that ended mid-read has moved the numbers the running read will report.
   */
  private planUsageRead: Promise<void> | null = null;
  private planUsageReadQueued = false;
  /**
   * Context windows the backend supplied for models the wire reports no window for,
   * keyed by wire model id — windows belong to models, so a model switch needs no
   * invalidation. A synchronous mirror of the backend's async answer on purpose:
   * AgentSession ignores a windowless snapshot once it holds a windowed one, so every
   * usage update after the first must be enriched inline or the meter would go stale
   * for the rest of the session.
   */
  private readonly backendContextWindows = new Map<string, number>();

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
      this.sawLiveUsage.clear();
      this.loadSessionCollectors.clear();
      this.permissionPrompter = null;
      this.capabilities.clear();
      // Dropped rather than kept: a backend that starts again may be pointed at
      // different credentials, and a snapshot held across that would show the previous
      // account's caps. The next chat to attach reads fresh.
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
      // Experimental ACP capability: presence of the (possibly empty) object
      // means the agent honors `additionalDirectories` on session lifecycle
      // requests. codex 0.135 / opencode 1.2.27 don't advertise it, so they
      // receive no field. Gating here auto-enables future versions that do.
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
    // Expired windows are dropped rather than replayed: this process outlives many
    // chats, and a snapshot taken before a reset describes a period that has ended.
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
      // Nothing read yet this run. The caps outlive the process, so the first chat to
      // open has somewhere to read them from and should not have to run a turn first.
      void this.refreshPlanUsage();
    }
    return () => {
      // Only tear down if THIS handler is still the registered one — a later
      // re-register for the same sessionId (resume/reconnect) must not have its
      // live tracker deleted by the stale unsubscribe.
      if (this.domainHandlers.get(sessionId) === handler) {
        this.domainHandlers.delete(sessionId);
        // Teardown (not per-turn): the handler is unregistered only when the
        // AgentSession disposes, so drop this session's per-session trackers too.
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
    // Fallback usage source for agents that never push a live `usage_update`
    // notification: the prompt result may carry a turn `usage` with no context
    // window. `usage.totalTokens` is a cumulative session total (not current
    // context occupancy), so once a live `usage_update` has reported occupancy
    // for this session we skip the fallback rather than overwrite the finer
    // value. AgentSession's precedence rule then keeps the live window too.
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
    // A turn is what moves the caps, so its end is the moment to look again. Not
    // awaited: the turn is over, and making the user wait on the read to see it end
    // would trade a visible delay for a meter that refreshes a beat later.
    void this.refreshPlanUsage();
    return { stopReason: stopReasonFromAcp(resp.stopReason) };
  }

  /**
   * Ask the backend for the account's plan-cap utilization and publish what it says.
   *
   * Best-effort by construction: a backend with no source omits `readPlanUsage`
   * entirely, and a read that failed or was unusable changes nothing — we learned
   * nothing about the account, so the last good snapshot stands rather than blanking a
   * meter the user is reading. A read that succeeded and reported no caps is different:
   * this login is not metered by plan limits, so any caps on screen describe an account
   * the user is no longer on and are cleared
   * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
   *
   * Published to every attached session, not to whichever one prompted the read: the
   * number describes the account, so it is equally true of every open chat, and routing
   * it to one would leave the others showing a stale number until they each ran a turn.
   */
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
    // Shut down (or exited) while the read was in flight: the answer describes an
    // account the next start() may no longer be on, so it must not outlive the reset.
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

  /**
   * The account cap snapshot as one session should see it: the caps meter a session
   * only while its current model bills the metered account (see
   * {@link AcpBackend.planUsageAppliesTo}), so a session on some other billing source
   * gets `null` — its meters stay off, or clear — while the snapshot itself stays
   * cached for the sessions the caps do describe.
   */
  private planUsageFor(sessionId: SessionId): PlanUsage | null {
    if (!this.lastPlanUsage) return null;
    const applies = this.backend.planUsageAppliesTo?.(this.currentWireModelId(sessionId)) ?? true;
    return applies ? this.lastPlanUsage : null;
  }

  /**
   * Re-send one session's gated view of the caps after its model may have changed: a
   * switch off a metered model clears its meters at once, a switch onto one shows the
   * cached snapshot at once, and neither waits for the next turn to end. A no-op until
   * a snapshot exists — with nothing cached there is nothing to show or clear.
   */
  private republishPlanUsage(sessionId: SessionId): void {
    if (!this.lastPlanUsage || !this.backend.planUsageAppliesTo) return;
    this.domainHandlers.get(sessionId)?.({
      sessionId,
      update: { sessionUpdate: "plan_usage_update", planUsage: this.planUsageFor(sessionId) },
    });
  }

  async cancel(params: CancelInput): Promise<void> {
    return this.requireConnection().cancel(cancelInputToAcp(params));
  }

  hasCapability(cap: AcpCapability): boolean {
    return this.capabilities.get(cap) === true;
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
    this.republishPlanUsage(params.sessionId);
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
    // A config option can be the model itself (opencode ≥ 1.15.13), so the session's
    // gated view of the caps may just have changed with it.
    this.republishPlanUsage(params.sessionId);
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
          mcpServers: [],
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
    const sessionId = params.sessionId;
    // Installed before the request goes out: the agent replays the conversation
    // while it is in flight, so a collector added afterwards would miss it.
    const collector = createReplayTranscriptState();
    this.loadSessionCollectors.set(sessionId, collector);

    try {
      const wireResp = await this.dispatchCapability(
        "session/load",
        (c) =>
          c.loadSession({
            sessionId: sessionIdToAcp(sessionId),
            cwd: params.cwd,
            mcpServers: [],
            ...this.additionalDirectoriesField(params.additionalDirectories),
          }),
        { mustBeAdvertised: true }
      );
      this.recordWireState(sessionIdToAcp(sessionId), {
        models: wireResp.models ?? null,
        modes: wireResp.modes ?? null,
        configOptions: wireResp.configOptions ?? null,
      });
      return {
        sessionId,
        state: this.computeState(sessionIdToAcp(sessionId)),
        transcript: finishReplayTranscript(collector),
      };
    } finally {
      // Only retire OUR accumulator: `loadSession` is public and has more than
      // one caller (history resume and the model preloader), so a concurrent
      // load for the same session would otherwise have its accumulator deleted
      // here and its frames folded into ours. Mirrors the same guard in
      // `registerSessionHandler`.
      //
      // DESIGN NOTE — this guard does not make two *overlapping* loads of the
      // same session safe, and deliberately so. ACP notifications carry only a
      // session id, no request id, so overlapping replays of one session are
      // unsplittable at this layer and would need single-flighting here. No
      // caller can produce that overlap: history resume already single-flights
      // per (backend, session) in `AgentSessionManager.tryResumeSessionFromHistory`,
      // and the preloader only ever loads its own probe session, on a process it
      // owns until that load has resolved. Single-flighting again here would be
      // a second copy of a guard the one reachable caller already has. If a
      // future review flags this again, point them at this note.
      if (this.loadSessionCollectors.get(sessionId) === collector) {
        this.loadSessionCollectors.delete(sessionId);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.connection = null;
    this.domainHandlers.clear();
    this.pendingUpdates.clear();
    this.sessionWireState.clear();
    this.todoToolCallIdsBySession.clear();
    this.loadSessionCollectors.clear();
    this.sawLiveUsage.clear();
    this.permissionPrompter = null;
    this.capabilities.clear();
    // Same reasoning as the exit handler: the next start() may authenticate as a
    // different account, so nothing about this one may survive the restart.
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

    // ACP owns wire discrimination; backends can reject only vendor-owned agent-message text.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/315
    if (
      update.update.sessionUpdate === "agent_message_chunk" &&
      update.update.content.type === "text" &&
      this.backend.shouldRouteAgentMessageText?.(update.update.content.text) === false
    ) {
      return;
    }

    // If there's an active loadSession collector for this session, feed it
    // user/agent message chunks and skip normal routing.
    // A replay in progress claims the conversation frames; everything it does
    // not claim (mode, config, usage, title) still belongs to the session and
    // falls through to normal routing below.
    //
    // DESIGN NOTE — the `session/load` response is the replay barrier. ACP
    // requires the agent to finish replaying before it answers, so a
    // conversation frame arriving afterwards is a backend violation and is
    // dropped by the normal path rather than reopening a retired accumulator.
    // Holding one open past the response would mean mutating a transcript the
    // session has already rendered. If a future review flags this again, point
    // them at this note.
    const collector = this.loadSessionCollectors.get(sessionId);
    if (collector && consumeReplayUpdate(collector, update.update)) return;

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
    // Record a live occupancy source so the prompt-result fallback stays quiet.
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

    // Per-dimension wire updates already mutated `wire` above; AgentSession
    // ignores them and waits for the synthesized `state_changed` we publish
    // below. Skip the original to avoid a wasted translation + dispatch.
    const sub = update.update.sessionUpdate;
    if (sub === "current_mode_update" || sub === "config_option_update") {
      handler({
        sessionId,
        update: { sessionUpdate: "state_changed", state: this.computeState(sessionId) },
      });
      // An agent-initiated config change can carry a new model (opencode ≥ 1.15.13
      // keeps its catalog in a config option), moving the session on or off the
      // metered account.
      if (sub === "config_option_update") this.republishPlanUsage(sessionId);
      return;
    }

    for (const event of acpNotificationToEvents(update, this.todoToolCallIdsFor(sessionId)))
      handler(this.withBackendContextWindow(event));
  }

  /**
   * Fill in a context window the wire did not supply, from the backend's own knowledge
   * of the model (see {@link AcpBackend.readContextWindow}). Enriched inline when the
   * window is already known; the first windowless snapshot for a model triggers the
   * async read instead, and is republished once the answer arrives.
   */
  private withBackendContextWindow(event: SessionEvent): SessionEvent {
    if (!this.backend.readContextWindow) return event;
    if (event.update.sessionUpdate !== "usage_update") return event;
    const usage = event.update.usage;
    if (usage.contextWindow) return event; // the wire knew; nothing to add
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

  /**
   * The context window the backend's own catalog gives a model, through this process's
   * cache. Public as `BackendProcess.readContextWindow`: a session seeding persisted
   * usage asks here so a reopened chat's ring does not wait for its next turn.
   *
   * A null answer is deliberately not cached: the backend answers null both for a
   * model it does not know and for a source it could not reach, so remembering it
   * would turn one transient failure into a bare token count for the rest of the
   * session.
   */
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
    // The session may have switched models while the catalog answered. Republishing the
    // old model's snapshot now would hand AgentSession a windowed reading it treats as
    // authoritative — re-freezing the very ring its model-change handling just cleared.
    if (this.currentWireModelId(sessionId) !== wireModelId) return;
    // Republish the snapshot that arrived windowless so the ring fills in now rather
    // than on the next usage report.
    this.domainHandlers.get(sessionId)?.({
      sessionId,
      update: { sessionUpdate: "usage_update", usage: { ...usage, contextWindow } },
    });
  }

  /**
   * Wire model id the session is currently on, from the cached wire state — the
   * dedicated `models` state when the agent has one, else the `category:"model"` config
   * option (opencode ≥ 1.15.13 exposes the catalog only there).
   */
  private currentWireModelId(sessionId: SessionId): string | null {
    const wire = this.sessionWireState.get(sessionId);
    if (!wire) return null;
    if (wire.models?.currentModelId) return wire.models.currentModelId;
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
}
