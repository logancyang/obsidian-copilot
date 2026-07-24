import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { translateBackendState } from "@/agentMode/session/translateBackendState";
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
  RawModelState,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { logError, logWarn } from "@/logger";
import { createPiEngine, type PiEngine } from "@/pi/engine";
import { createPiModels, listPiModels } from "@/pi/providers";
import type { PiModelEntry, PiProviderDeps } from "@/pi/types";
import type { Models } from "@earendil-works/pi-ai";
import { v4 as uuidv4 } from "uuid";
import { toSessionUsage, translatePiEvent } from "./piEventTranslate";

/** Cap on events buffered for a session whose handler has not registered yet. */
const PENDING_UPDATE_LIMIT = 32;

/** Frozen empty session list — this backend has no cross-restart session store yet. */
const NO_SESSIONS: ListSessionsOutput = Object.freeze({ sessions: [] });

export interface PiBackendProcessOptions {
  descriptor: BackendDescriptor;
  /**
   * Resolve what the provider collection needs from the host — the decrypted
   * license key, the user's OpenAI-compatible endpoints, and network access.
   * Read once when the collection is first built so a key entered later
   * applies on the next backend restart, matching how the other backends pick
   * up credential changes.
   */
  getProviderDeps: () => Promise<PiProviderDeps>;
  /** The user's sticky model preference, read when a session opens. */
  getDefaultModelId?: () => string | undefined;
  /** Composed Copilot system prompt, read once per session so a turn never changes it. */
  getSystemPrompt?: () => string | undefined;
}

interface PiSessionState {
  engine: PiEngine;
  unsubscribe: () => void;
  /** Set by `cancel()` so the in-flight turn reports why it stopped. */
  cancelled: boolean;
}

/**
 * Drives the bundled pi engine as an Agent Mode backend. Unlike the ACP
 * backends there is no subprocess and no install step: the engine runs
 * in-process, so bring-up is just building the provider collection on first
 * use. Owns the session ↔ engine mapping and the translation of pi's event
 * stream into session-domain updates; everything model- and transport-shaped
 * lives in `@/pi`, which stays free of Agent Mode types.
 */
export class PiBackendProcess implements BackendProcess {
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  private readonly pendingUpdates = new Map<SessionId, SessionEvent[]>();
  private readonly sessions = new Map<SessionId, PiSessionState>();
  private readonly exitListeners = new Set<() => void>();
  private models: Models | null = null;
  private modelsPromise: Promise<Models> | null = null;
  private catalog: readonly PiModelEntry[] = [];
  private shuttingDown = false;

  constructor(private readonly opts: PiBackendProcessOptions) {}

  isRunning(): boolean {
    return !this.shuttingDown;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * Accepted for interface compatibility and never called: the tools this
   * backend exposes are read-only, so no turn ever asks the user to approve
   * one.
   */
  setPermissionPrompter(_fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void {}

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    const buffered = this.pendingUpdates.get(sessionId);
    if (buffered) {
      this.pendingUpdates.delete(sessionId);
      for (const event of buffered) {
        try {
          handler(event);
        } catch (e) {
          logWarn(`[AgentMode] replay of buffered pi event threw for ${sessionId}`, e);
        }
      }
    }
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async newSession(_params: OpenSessionInput): Promise<OpenSessionOutput> {
    const models = await this.ensureModels();
    const modelId = this.resolveSeedModelId();
    if (!modelId) {
      throw new Error(
        "No pi models are available. Check your Copilot Plus license key or add an OpenAI-compatible provider."
      );
    }
    const sessionId = uuidv4();
    const engine = createPiEngine({
      models,
      modelId,
      systemPrompt: this.opts.getSystemPrompt?.(),
    });
    const unsubscribe = engine.subscribe((event) => {
      for (const update of translatePiEvent(event)) {
        this.dispatchEvent({ sessionId, update });
      }
      if (event.type === "turn_end") {
        this.dispatchEvent({
          sessionId,
          update: {
            sessionUpdate: "usage_update",
            usage: toSessionUsage(engine.usage(), Date.now()),
          },
        });
      }
    });
    this.sessions.set(sessionId, { engine, unsubscribe, cancelled: false });
    return { sessionId, state: this.computeState(sessionId) };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    const session = this.requireSession(params.sessionId);
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    const images = params.prompt
      .filter(
        (block): block is { type: "image"; mimeType: string; data: string } =>
          block.type === "image"
      )
      .map((block) => ({ type: "image" as const, data: block.data, mimeType: block.mimeType }));
    session.cancelled = false;
    try {
      await session.engine.prompt(text, images.length > 0 ? images : undefined);
    } catch (error) {
      // A turn the user stopped surfaces as a cancellation, not a failure —
      // the engine may either resolve with the partial message or reject,
      // depending on where the abort landed.
      if (!session.cancelled) throw error;
    }
    return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
  }

  async cancel(params: CancelInput): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;
    session.cancelled = true;
    await session.engine.abort();
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    const session = this.requireSession(params.sessionId);
    await session.engine.setModel(params.modelId);
    return this.computeState(params.sessionId);
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  setSessionMode(): Promise<BackendState> {
    return Promise.reject(new MethodUnsupportedError("pi has no mode selection"));
  }

  isSetSessionModeSupported(): boolean | null {
    return false;
  }

  setSessionConfigOption(): Promise<BackendState> {
    return Promise.reject(new MethodUnsupportedError("pi has no config options"));
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return false;
  }

  listSessions(_params: ListSessionsInput): Promise<ListSessionsOutput> {
    return Promise.resolve(NO_SESSIONS);
  }

  resumeSession(_params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    return Promise.reject(new MethodUnsupportedError("pi cannot resume a session yet"));
  }

  loadSession(_params: LoadSessionInput): Promise<LoadSessionOutput> {
    return Promise.reject(new MethodUnsupportedError("pi cannot load a session yet"));
  }

  supportsMcpTransport(): boolean {
    return false;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      session.unsubscribe();
      try {
        await session.engine.abort();
      } catch (e) {
        logWarn("[AgentMode] pi abort during shutdown threw", e);
      }
    }
    this.sessions.clear();
    this.sessionHandlers.clear();
    this.pendingUpdates.clear();
    for (const fn of this.exitListeners) {
      try {
        fn();
      } catch (e) {
        logWarn("[AgentMode] pi exit listener threw", e);
      }
    }
    this.exitListeners.clear();
  }

  /**
   * Build the provider collection once per backend lifetime and pull the
   * Copilot Plus catalog, so the picker never opens on an empty model list.
   * Concurrent callers join the same build.
   */
  private ensureModels(): Promise<Models> {
    if (this.models) return Promise.resolve(this.models);
    if (this.modelsPromise) return this.modelsPromise;
    const promise = (async () => {
      const models = createPiModels(await this.opts.getProviderDeps());
      await models.refresh();
      this.models = models;
      this.catalog = listPiModels(models);
      return models;
    })().catch((error: unknown) => {
      this.modelsPromise = null;
      throw error;
    });
    this.modelsPromise = promise;
    return promise;
  }

  private resolveSeedModelId(): string | undefined {
    const preferred = this.opts.getDefaultModelId?.();
    if (preferred && this.catalog.some((entry) => entry.id === preferred)) return preferred;
    return this.catalog[0]?.id;
  }

  private requireSession(sessionId: SessionId): PiSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return session;
  }

  private computeState(sessionId: SessionId): BackendState {
    const currentModelId = this.sessions.get(sessionId)?.engine.getModelId();
    const models: RawModelState | null =
      currentModelId && this.catalog.length > 0
        ? {
            currentModelId,
            availableModels: this.catalog.map((entry) => ({
              modelId: entry.id,
              name: entry.label,
              description: entry.description,
            })),
          }
        : null;
    return translateBackendState(
      { models, modes: null, configOptions: null },
      this.opts.descriptor
    );
  }

  private dispatchEvent(event: SessionEvent): void {
    const handler = this.sessionHandlers.get(event.sessionId);
    if (!handler) {
      let queue = this.pendingUpdates.get(event.sessionId);
      if (!queue) {
        queue = [];
        this.pendingUpdates.set(event.sessionId, queue);
      }
      if (queue.length >= PENDING_UPDATE_LIMIT) {
        logWarn(
          `[AgentMode] dropping pi event for ${event.sessionId}: pending buffer full (${queue.length})`
        );
        return;
      }
      queue.push(event);
      return;
    }
    try {
      handler(event);
    } catch (e) {
      logError(`[AgentMode] pi event handler threw for ${event.sessionId}`, e);
    }
  }
}
