/**
 * Pool-semantics tests for AgentSessionManager. The shared backend
 * subprocess and the AgentSession factory are mocked so we can exercise
 * session-pool invariants without touching ACP or spawning a child process.
 */
import { FileSystemAdapter, App } from "obsidian";
import { AgentSession } from "./AgentSession";
import { AgentSessionManager } from "./AgentSessionManager";
import type { BackendDescriptor } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    agentMode: { activeBackend: "opencode", backends: {} },
  })),
  setSettings: jest.fn(),
}));

let mockBackendIsRunning = true;
const mockBackendShutdown = jest.fn(async () => undefined);
const mockBackendStart = jest.fn(async () => undefined);
const mockBackendExitListeners = new Set<() => void>();
const mockSetPermissionPrompter = jest.fn();

jest.mock("@/agentMode/acp/AcpBackendProcess", () => ({
  AcpBackendProcess: jest.fn().mockImplementation(() => ({
    start: mockBackendStart,
    setPermissionPrompter: mockSetPermissionPrompter,
    onExit: (fn: () => void) => {
      mockBackendExitListeners.add(fn);
      return () => mockBackendExitListeners.delete(fn);
    },
    isRunning: () => mockBackendIsRunning,
    shutdown: mockBackendShutdown,
  })),
}));

const mockSessionDispose = jest.fn(async () => undefined);
const mockSessionCancel = jest.fn(async () => undefined);
let nextAcpSessionId = 1;

function makeMockSession(overrides: {
  internalId: string;
  acpSessionId?: string;
  backendId: string;
  ready?: Promise<void>;
}): AgentSession {
  const acpId = overrides.acpSessionId ?? `acp-${nextAcpSessionId++}`;
  return {
    internalId: overrides.internalId,
    backendId: overrides.backendId,
    ready: overrides.ready ?? Promise.resolve(),
    getAcpSessionId: () => acpId,
    getStatus: () => "idle",
    cancel: mockSessionCancel,
    dispose: mockSessionDispose,
    setModel: jest.fn(),
    getLabel: () => null,
    setLabel: jest.fn(),
    subscribe: () => () => {},
    hasUserVisibleMessages: () => false,
    getModelState: () => null,
    getModeState: () => null,
    getConfigOptions: () => null,
  } as unknown as AgentSession;
}

const sessionCreateSpy = jest
  .spyOn(AgentSession, "start")
  .mockImplementation((opts) =>
    makeMockSession({ internalId: opts.internalId, backendId: opts.backendId })
  );

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  return { vault: { adapter } } as unknown as App;
}

function buildPlugin(): { manifest: { version: string } } {
  return { manifest: { version: "1.0.0" } };
}

function buildDescriptor(): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    getInstallState: jest.fn(),
    subscribeInstallState: jest.fn(),
    openInstallUI: jest.fn(),
    createBackend: jest.fn(() => ({
      id: "opencode",
      displayName: "opencode",
      buildSpawnDescriptor: jest.fn(),
    })),
  } as unknown as BackendDescriptor;
}

function buildManager(): AgentSessionManager {
  const descriptor = buildDescriptor();
  const modelPreloader = {
    getCachedModels: jest.fn(() => null),
    preload: jest.fn(async () => undefined),
    subscribe: jest.fn(() => () => {}),
    shutdown: jest.fn(),
    setCached: jest.fn(),
  };
  return new AgentSessionManager(
    buildApp(),
    buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
    {
      permissionPrompter: jest.fn(),
      resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
      modelPreloader: modelPreloader as unknown as ConstructorParameters<
        typeof AgentSessionManager
      >[2]["modelPreloader"],
    }
  );
}

beforeEach(() => {
  mockBackendIsRunning = true;
  mockBackendStart.mockClear();
  mockBackendShutdown.mockClear();
  mockSetPermissionPrompter.mockClear();
  mockBackendExitListeners.clear();
  mockSessionCancel.mockClear();
  mockSessionDispose.mockClear();
  sessionCreateSpy.mockClear();
  nextAcpSessionId = 1;
});

describe("AgentSessionManager.createSession", () => {
  it("creates a session and sets it as the active one", async () => {
    const mgr = buildManager();
    const session = await mgr.createSession();
    expect(mgr.getSessions()).toEqual([session]);
    expect(mgr.getActiveSession()).toBe(session);
    expect(mgr.getActiveChatUIState()).not.toBeNull();
    expect(mgr.getChatUIState(session.internalId)).toBe(mgr.getActiveChatUIState());
  });

  it("creating a second session sets it as active but keeps the first in the pool", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    expect(mgr.getSessions()).toEqual([a, b]);
    expect(mgr.getActiveSession()).toBe(b);
  });

  it("two concurrent createSession calls each spawn their own session", async () => {
    const mgr = buildManager();
    const [a, b] = await Promise.all([mgr.createSession(), mgr.createSession()]);
    expect(a).not.toBe(b);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(2);
    expect(mgr.getSessions()).toHaveLength(2);
  });

  it("only spawns the backend once across multiple createSession calls", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    await mgr.createSession();
    await mgr.createSession();
    expect(mockBackendStart).toHaveBeenCalledTimes(1);
  });

  it("mirrors the new session's model state into the preloader cache", async () => {
    const cache = new Map<string, { models: unknown; modes: unknown; configOptions: unknown }>();
    const modelPreloader = {
      getCachedModels: jest.fn((id: string) => cache.get(id)?.models ?? null),
      getCachedModes: jest.fn((id: string) => cache.get(id)?.modes ?? null),
      getCachedConfigOptions: jest.fn((id: string) => cache.get(id)?.configOptions ?? null),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(
        (id: string, partial: { models?: unknown; modes?: unknown; configOptions?: unknown }) => {
          const prev = cache.get(id) ?? { models: null, modes: null, configOptions: null };
          cache.set(id, {
            models: "models" in partial ? partial.models : prev.models,
            modes: "modes" in partial ? partial.modes : prev.modes,
            configOptions: "configOptions" in partial ? partial.configOptions : prev.configOptions,
          });
        }
      ),
    };
    const descriptor = buildDescriptor();
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );

    const modelState = {
      currentModelId: "anthropic/sonnet",
      availableModels: [{ modelId: "anthropic/sonnet", name: "Claude Sonnet" }],
    };
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getModelState: () => unknown }).getModelState = () => modelState;
      return s;
    });

    await mgr.createSession();
    // Only non-null fields are passed; null modes/configOptions would otherwise
    // clobber the previous session's cached entries when starting a new tab.
    expect(modelPreloader.setCached).toHaveBeenCalledWith("opencode", {
      models: modelState,
    });
    expect(mgr.getCachedModels("opencode")).toBe(modelState);

    // Spawning a second session before its session/new resolves must not
    // overwrite the cached state with nulls — otherwise the picker shows
    // "select model" until the new session finishes starting.
    sessionCreateSpy.mockImplementationOnce((opts) =>
      makeMockSession({ internalId: opts.internalId, backendId: opts.backendId })
    );
    await mgr.createSession();
    expect(mgr.getCachedModels("opencode")).toBe(modelState);
  });

  it("a concurrent create that succeeds does not wipe a sibling create's lastError", async () => {
    const mgr = buildManager();
    // First call fails. Second call starts before first settles, so the
    // pre-fix code would have cleared `lastError` at the second call's start
    // and the failure surfaced by the first would be lost.
    sessionCreateSpy
      .mockImplementationOnce((opts) =>
        makeMockSession({
          internalId: opts.internalId,
          backendId: opts.backendId,
          // Failing session: ready rejects after a microtask. The second
          // create's ready resolves immediately; with concurrent flushing,
          // we still want the first failure to win in lastError.
          ready: (async () => {
            await Promise.resolve();
            await Promise.resolve();
            throw new Error("boom");
          })(),
        })
      )
      .mockImplementationOnce((opts) =>
        makeMockSession({
          internalId: opts.internalId,
          acpSessionId: "acp-ok",
          backendId: opts.backendId,
        })
      );

    const failingSession = await mgr.createSession();
    const succeedingSession = await mgr.createSession();
    // Drain the ready continuations so lastError is populated.
    await failingSession.ready.catch(() => undefined);
    await succeedingSession.ready;
    // Allow the manager's `.finally` continuation to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(mgr.getLastError()).toMatch(/boom/);
  });
});

describe("AgentSessionManager.getOrCreateActiveSession", () => {
  it("dedupes concurrent auto-spawn callers into a single session", async () => {
    const mgr = buildManager();
    const [a, b] = await Promise.all([
      mgr.getOrCreateActiveSession(),
      mgr.getOrCreateActiveSession(),
    ]);
    expect(a).toBe(b);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getSessions()).toHaveLength(1);
  });

  it("returns the existing active session on subsequent calls", async () => {
    const mgr = buildManager();
    const a = await mgr.getOrCreateActiveSession();
    const again = await mgr.getOrCreateActiveSession();
    expect(again).toBe(a);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSessionManager.closeSession", () => {
  it("removes the session from the pool and cancels + disposes it", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    await mgr.closeSession(a.internalId);
    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mockSessionCancel).toHaveBeenCalled();
    expect(mockSessionDispose).toHaveBeenCalled();
  });

  it("when the active session is closed, picks the right neighbor as active", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    const c = await mgr.createSession();
    mgr.setActiveSession(b.internalId);
    await mgr.closeSession(b.internalId);
    // [a, b, c] -> close b (idx 1) -> remaining [a, c] -> idx 1 -> c
    expect(mgr.getActiveSession()).toBe(c);
    expect(mgr.getSessions()).toEqual([a, c]);
  });

  it("when the rightmost active session is closed, falls back to the new last", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    expect(mgr.getActiveSession()).toBe(b);
    await mgr.closeSession(b.internalId);
    // [a, b] -> close b (idx 1) -> remaining [a] -> idx min(1, 0) = 0 -> a
    expect(mgr.getActiveSession()).toBe(a);
  });

  it("closing a non-active session leaves the active pointer alone", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    await mgr.closeSession(a.internalId);
    expect(mgr.getActiveSession()).toBe(b);
    expect(mgr.getSessions()).toEqual([b]);
  });

  it("is a no-op for unknown ids", async () => {
    const mgr = buildManager();
    await mgr.closeSession("does-not-exist");
    expect(mgr.getSessions()).toEqual([]);
  });
});

describe("AgentSessionManager.setActiveSession", () => {
  it("moves the active pointer to the given id", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    expect(mgr.getActiveSession()).toBe(b);
    mgr.setActiveSession(a.internalId);
    expect(mgr.getActiveSession()).toBe(a);
  });

  it("is a silent no-op on unknown id", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    expect(() => mgr.setActiveSession("nope")).not.toThrow();
    expect(mgr.getActiveSession()).toBe(a);
  });
});

describe("AgentSessionManager.subscribe / shutdown", () => {
  it("notifies subscribers on session create / close / activate", async () => {
    const mgr = buildManager();
    const listener = jest.fn();
    mgr.subscribe(listener);

    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    await mgr.closeSession(b.internalId);

    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("shutdown cancels and disposes every session and clears state", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    await mgr.createSession();
    expect(mgr.getSessions()).toHaveLength(2);

    await mgr.shutdown();
    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mockSessionCancel).toHaveBeenCalledTimes(2);
    expect(mockSessionDispose).toHaveBeenCalledTimes(2);
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
  });

  it("backend exit drops every session and surfaces lastError", async () => {
    const mgr = buildManager();
    const listener = jest.fn();
    mgr.subscribe(listener);
    await mgr.createSession();
    await mgr.createSession();

    // Simulate the subprocess exiting.
    for (const fn of mockBackendExitListeners) fn();

    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mgr.getLastError()).toMatch(/exited unexpectedly/);
    expect(listener).toHaveBeenCalled();
  });
});

describe("AgentSessionManager.buildEffortApplyContext", () => {
  it("returns null when no session is active", () => {
    const mgr = buildManager();
    expect(mgr.buildEffortApplyContext("opencode")).toBeNull();
  });

  it("returns null when the active session is on a different backend", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    // Active session is on `opencode`; asking for a different backend
    // must refuse so a stray cross-backend effort apply can't slip through.
    expect(mgr.buildEffortApplyContext("claude-code")).toBeNull();
  });

  it("returns a context bound to the active session for the matching backend", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    const ctx = mgr.buildEffortApplyContext("opencode");
    expect(ctx).not.toBeNull();
    expect(typeof ctx!.setSessionModel).toBe("function");
    expect(typeof ctx!.setSessionConfigOption).toBe("function");
    expect(typeof ctx!.persistModelSelection).toBe("function");
    expect(typeof ctx!.persistEffort).toBe("function");
  });
});
