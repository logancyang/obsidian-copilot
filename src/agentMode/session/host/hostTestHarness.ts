import type { ServerFrame } from "@/agentMode/protocol/frames";
import {
  INITIAL_HOST_FLAGS,
  type BackendSummary,
  type HostFlags,
} from "@/agentMode/protocol/state";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { SessionHostManager } from "@/agentMode/session/host/commandHandlers";
import {
  createInProcessTransport,
  type InProcessTransportOptions,
} from "@/agentMode/session/host/inProcessTransport";
import type { CatalogSource } from "@/agentMode/session/host/CatalogProjector";
import { SessionHost, type SessionHostOptions } from "@/agentMode/session/host/SessionHost";
import type {
  BackendId,
  BackendProcess,
  BackendState,
  CopilotMode,
  ModelSelection,
  PromptOutput,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { TFile } from "obsidian";

export interface MockBackend {
  process: BackendProcess;
  emit: (event: SessionEvent) => void;
  prompt: jest.Mock<Promise<PromptOutput>, []>;
  cancel: jest.Mock;
  holdPrompt: () => (stopReason?: PromptOutput["stopReason"]) => void;
}

export const EMPTY_BACKEND_STATE: BackendState = { model: null, mode: null };

export function makeMockBackend(): MockBackend {
  let handler: SessionUpdateHandler | null = null;
  const prompt = jest.fn(async (): Promise<PromptOutput> => ({ stopReason: "end_turn" }));
  const cancel = jest.fn(async () => undefined);
  const process: BackendProcess = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: (_id, h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    newSession: async () => ({ sessionId: "acp-1", state: EMPTY_BACKEND_STATE }),
    prompt,
    cancel,
    closeSession: async () => undefined,
    setSessionModel: async () => EMPTY_BACKEND_STATE,
    isSetSessionModelSupported: () => true,
    setSessionMode: async () => EMPTY_BACKEND_STATE,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: async () => EMPTY_BACKEND_STATE,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: async () => ({ sessions: [] }),
    resumeSession: () => Promise.reject(new MethodUnsupportedError("resume")),
    loadSession: () => Promise.reject(new MethodUnsupportedError("load")),
    shutdown: async () => {},
  };
  const holdPrompt = () => {
    let release: (output: PromptOutput) => void = () => {};
    prompt.mockImplementationOnce(
      () => new Promise<PromptOutput>((resolve) => (release = resolve))
    );
    return (stopReason: PromptOutput["stopReason"] = "end_turn") => release({ stopReason });
  };
  return { process, emit: (event) => handler?.(event), prompt, cancel, holdPrompt };
}

export interface TestSession {
  session: AgentSession;
  backend: MockBackend;
}

export function makeTestSession(
  internalId = "s1",
  backendId = "claude",
  projectId?: string
): TestSession {
  const backend = makeMockBackend();
  const session = new AgentSession({
    backend: backend.process,
    backendSessionId: `acp-${internalId}`,
    internalId,
    backendId,
    ...(projectId ? { projectId } : {}),
  });
  return { session, backend };
}

export class FakeCatalog implements CatalogSource {
  backends: BackendSummary[] = [];
  flags: HostFlags = { ...INITIAL_HOST_FLAGS };
  private listeners = new Set<() => void>();

  listBackends(): readonly BackendSummary[] {
    return this.backends;
  }

  getFlags(): HostFlags {
    return this.flags;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  change(next: { backends?: BackendSummary[]; flags?: Partial<HostFlags> }): void {
    if (next.backends) this.backends = next.backends;
    if (next.flags) this.flags = { ...this.flags, ...next.flags };
    for (const listener of [...this.listeners]) listener();
  }
}

export class FakeManager implements SessionHostManager {
  private sessions = new Map<string, AgentSession>();
  private detached = new Set<string>();
  private listeners = new Set<() => void>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  nextSession: (() => AgentSession) | null = null;
  applyFailure: Error | null = null;

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async createSession(
    backendId?: BackendId,
    projectId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession> {
    this.record("createSession", backendId, projectId, seedSelection);
    const session = this.nextSession?.() ?? makeTestSession(`created-${this.calls.length}`).session;
    this.add(session);
    return session;
  }

  async replaceSessionInPlace(
    oldId: string,
    backendId?: BackendId,
    options?: { preserveChatInput?: boolean; seedSelection?: ModelSelection }
  ): Promise<AgentSession> {
    this.record("replaceSessionInPlace", oldId, backendId, options);
    const session =
      this.nextSession?.() ?? makeTestSession(`replaced-${this.calls.length}`).session;
    this.add(session);
    return session;
  }

  openTab(id: string): void {
    this.record("openTab", id);
    if (this.detached.delete(id)) this.notify();
  }

  detachSessionFromTab(id: string): void {
    this.record("detachSessionFromTab", id);
    this.detach(id);
  }

  renameSession(id: string, label: string | null): void {
    this.record("renameSession", id, label);
    this.sessions.get(id)?.setLabel(label);
  }

  async applySelectionTo(
    id: string,
    patch: { baseModelId?: string; effort?: string | null }
  ): Promise<void> {
    this.record("applySelectionTo", id, patch);
    if (this.applyFailure) throw this.applyFailure;
  }

  async applyModeTo(id: string, mode: CopilotMode): Promise<void> {
    this.record("applyModeTo", id, mode);
  }

  add(session: AgentSession): void {
    this.sessions.set(session.internalId, session);
    this.notify();
  }

  replace(session: AgentSession): void {
    this.sessions.set(session.internalId, session);
    this.notify();
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.detached.delete(id);
    this.notify();
  }

  detach(id: string): void {
    this.detached.add(id);
    this.notify();
  }

  reorder(ids: string[]): void {
    const next = new Map<string, AgentSession>();
    for (const id of ids) next.set(id, this.sessions.get(id)!);
    this.sessions = next;
    this.notify();
  }

  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  getSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  getTabSessions(): AgentSession[] {
    return this.getSessions().filter((session) => !this.detached.has(session.internalId));
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function fakeNote(path: string): TFile {
  const basename = path.split("/").pop()!.replace(/\.md$/, "");
  return Object.assign(new TFile(), { path, basename });
}

export function buildHost(
  manager: SessionHostManager,
  overrides: Partial<SessionHostOptions> = {}
): SessionHost {
  return new SessionHost({
    manager,
    catalog: new FakeCatalog(),
    resolveNote: (path) => (path.startsWith("missing/") ? null : fakeNote(path)),
    isKnownBackend: (id) => ["claude", "codex", "opencode"].includes(id),
    isKnownProject: (id) => id === GLOBAL_SCOPE || id === "known-project",
    appVersion: "test-1.0.0",
    newHostId: () => "host-under-test",
    ...overrides,
  });
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

export interface FaultyTransport extends ClientTransport {
  disconnect(): void;
  reconnect(): void;
  dropNextFrame(): void;
}

export function createFaultyTransport(
  host: Pick<SessionHost, "connect">,
  options: InProcessTransportOptions
): FaultyTransport {
  const frameListeners = new Set<(frame: ServerFrame) => void>();
  const openListeners = new Set<(open: boolean) => void>();
  let inner: ClientTransport | null = null;
  let detach: Array<() => void> = [];
  let framesToDrop = 0;
  let isOpen = false;
  let closed = false;

  const setOpen = (open: boolean): void => {
    isOpen = open;
    for (const listener of [...openListeners]) listener(open);
  };
  const leave = (): void => {
    for (const stop of detach) stop();
    detach = [];
    inner?.close();
    inner = null;
  };
  const join = (): void => {
    const next = createInProcessTransport(host, options);
    inner = next;
    detach = [
      next.onFrame((frame) => {
        if (framesToDrop > 0) {
          framesToDrop -= 1;
          return;
        }
        for (const listener of [...frameListeners]) listener(frame);
      }),
      next.onOpenChange(setOpen),
    ];
  };
  join();

  return {
    send: (frame) => inner?.send(frame),
    onFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },
    onOpenChange(cb) {
      openListeners.add(cb);
      return () => {
        openListeners.delete(cb);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      leave();
      if (isOpen) setOpen(false);
    },
    disconnect() {
      if (closed || !isOpen) return;
      leave();
      setOpen(false);
    },
    reconnect() {
      if (closed || isOpen) return;
      join();
    },
    dropNextFrame() {
      framesToDrop += 1;
    },
  };
}

export function createFaultyClient(host: SessionHost): {
  client: SessionClient;
  transport: FaultyTransport;
} {
  const transport = createFaultyTransport(host, { serialize: true });
  return { client: new SessionClient(transport, { app: "test-1.0.0" }), transport };
}
