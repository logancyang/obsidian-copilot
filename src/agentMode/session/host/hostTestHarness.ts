import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { SessionHostManager } from "@/agentMode/session/host/commandHandlers";
import { SessionHost, type SessionHostOptions } from "@/agentMode/session/host/SessionHost";
import type {
  BackendProcess,
  BackendState,
  PromptOutput,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
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

export class FakeManager implements SessionHostManager {
  private sessions = new Map<string, AgentSession>();
  private detached = new Set<string>();
  private uiStates = new Map<string, AgentChatUIState>();
  private listeners = new Set<() => void>();

  add(session: AgentSession): void {
    this.sessions.set(session.internalId, session);
    this.uiStates.set(session.internalId, new AgentChatUIState(session));
    this.notify();
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.uiStates.delete(id);
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

  getChatUIState(id: string): AgentChatUIState | null {
    return this.uiStates.get(id) ?? null;
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
    resolveNote: (path) => (path.startsWith("missing/") ? null : fakeNote(path)),
    isKnownBackend: (id) => ["claude", "codex", "opencode"].includes(id),
    appVersion: "test-1.0.0",
    newHostId: () => "host-under-test",
    ...overrides,
  });
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
