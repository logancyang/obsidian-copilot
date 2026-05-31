/**
 * Pool-semantics tests for AgentSessionManager. The shared backend
 * subprocess and the AgentSession factory are mocked so we can exercise
 * session-pool invariants without touching ACP or spawning a child process.
 */
import { FileSystemAdapter, App } from "obsidian";
import { AgentSession } from "./AgentSession";
import { AgentSessionManager } from "./AgentSessionManager";
import { setSettings as mockedSetSettings } from "@/settings/model";
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

function makeMockBackendProcess() {
  return {
    start: mockBackendStart,
    setPermissionPrompter: mockSetPermissionPrompter,
    onExit: (fn: () => void) => {
      mockBackendExitListeners.add(fn);
      return () => mockBackendExitListeners.delete(fn);
    },
    isRunning: () => mockBackendIsRunning,
    shutdown: mockBackendShutdown,
    // Stub the session-event surface so warm-adoption tests can construct
    // a real `AgentSession` via the state-options branch without throwing.
    registerSessionHandler: jest.fn(() => () => {}),
  };
}

const mockSessionDispose = jest.fn(async () => undefined);
const mockSessionCancel = jest.fn(async () => undefined);
let nextBackendSessionId = 1;

interface MockSessionTestHandle {
  /** Drive the mock session's status the way the real session does. */
  setStatus(
    status: "starting" | "idle" | "running" | "awaiting_permission" | "error" | "closed"
  ): void;
}

const sessionTestHandles = new Map<string, MockSessionTestHandle>();

function getSessionTestHandle(session: AgentSession): MockSessionTestHandle {
  const handle = sessionTestHandles.get(session.internalId);
  if (!handle) throw new Error(`No test handle for ${session.internalId}`);
  return handle;
}

function makeMockSession(overrides: {
  internalId: string;
  backendSessionId?: string;
  backendId: string;
  ready?: Promise<void>;
}): AgentSession {
  const sessionId = overrides.backendSessionId ?? `backend-${nextBackendSessionId++}`;
  let status: "starting" | "idle" | "running" | "awaiting_permission" | "error" | "closed" = "idle";
  let needsAttention = false;
  const listeners = new Set<{
    onStatusChanged?: (s: typeof status) => void;
    onNeedsAttentionChanged?: (v: boolean) => void;
  }>();
  const session = {
    internalId: overrides.internalId,
    backendId: overrides.backendId,
    ready: overrides.ready ?? Promise.resolve(),
    getBackendSessionId: () => sessionId,
    getStatus: () => status,
    cancel: mockSessionCancel,
    dispose: mockSessionDispose,
    setModel: jest.fn(),
    setMode: jest.fn(),
    setConfigOption: jest.fn(),
    getLabel: () => null,
    setLabel: jest.fn(),
    subscribe: (l: Parameters<typeof listeners.add>[0]) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hasUserVisibleMessages: () => false,
    getState: () => null,
    getRawSnapshot: () => ({ models: null, modes: null, configOptions: null }),
    getNeedsAttention: () => needsAttention,
    markNeedsAttention: () => {
      if (needsAttention) return;
      needsAttention = true;
      for (const l of listeners) l.onNeedsAttentionChanged?.(true);
    },
    clearNeedsAttention: () => {
      if (!needsAttention) return;
      needsAttention = false;
      for (const l of listeners) l.onNeedsAttentionChanged?.(false);
    },
  } as unknown as AgentSession;
  sessionTestHandles.set(overrides.internalId, {
    setStatus: (next) => {
      if (status === next) return;
      status = next;
      for (const l of listeners) l.onStatusChanged?.(next);
    },
  });
  return session;
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
    // Default to installed: a manager that owns a running backend is, in
    // production, always operating on an installed one. Tests that exercise
    // the uninstalled path override this per-case.
    getInstallState: jest.fn(() => ({ kind: "ready" })),
    subscribeInstallState: jest.fn(),
    openInstallUI: jest.fn(),
    createBackendProcess: jest.fn(() => makeMockBackendProcess()),
  } as unknown as BackendDescriptor;
}

function buildManager(): AgentSessionManager {
  const descriptor = buildDescriptor();
  const modelPreloader = {
    getCachedBackendState: jest.fn(() => null),
    preload: jest.fn(async () => undefined),
    refresh: jest.fn(() => null),
    subscribe: jest.fn(() => () => {}),
    shutdown: jest.fn(),
    setCached: jest.fn(),
    clearCached: jest.fn(),
    takeWarm: jest.fn(() => null),
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
  nextBackendSessionId = 1;
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

  it("mirrors the new session's unified state into the preloader cache", async () => {
    const cache = new Map<string, unknown>();
    const modelPreloader = {
      getCachedBackendState: jest.fn((id: string) => cache.get(id) ?? null),
      preload: jest.fn(async () => undefined),
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn((id: string, state: unknown) => {
        cache.set(id, state);
      }),
      clearCached: jest.fn((id: string) => {
        cache.delete(id);
      }),
      takeWarm: jest.fn(() => null),
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

    const modelEntry = {
      baseModelId: "anthropic/sonnet",
      name: "Claude Sonnet",
      provider: "anthropic",
      effortOptions: [],
    };
    const unified = {
      model: { current: { model: modelEntry, effort: null }, availableModels: [modelEntry] },
      mode: null,
    };
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getState: () => unknown }).getState = () => unified;
      return s;
    });

    await mgr.createSession();
    expect(modelPreloader.setCached).toHaveBeenCalledWith("opencode", unified);
    expect(mgr.getCachedBackendState("opencode")).toBe(unified);

    // Spawning a second session before its session/new resolves must not
    // overwrite the cached state with nulls.
    sessionCreateSpy.mockImplementationOnce((opts) =>
      makeMockSession({ internalId: opts.internalId, backendId: opts.backendId })
    );
    await mgr.createSession();
    expect(mgr.getCachedBackendState("opencode")).toBe(unified);
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
          backendSessionId: "backend-ok",
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

describe("AgentSessionManager warm-backend adoption", () => {
  it("reuses the preloader's warm proc instead of spawning a fresh one", async () => {
    // A warm proc is just another mock backend — the manager doesn't care
    // it came from the preloader, only that it skips start() / newSession.
    const warmProc = makeMockBackendProcess();
    const descriptor = buildDescriptor();
    const probeState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        availableModels: [
          { baseModelId: "anthropic/sonnet", name: "Sonnet", provider: null, effortOptions: [] },
        ],
      },
      mode: null,
    };
    const takeWarmMock = jest
      .fn()
      .mockReturnValueOnce({
        proc: warmProc,
        probeSessionId: "probe-1",
        state: probeState,
      })
      .mockReturnValue(null);
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => probeState),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: takeWarmMock,
    };
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

    await mgr.createSession();

    // start() on the warm proc must not be re-invoked — preload already did it.
    expect(mockBackendStart).not.toHaveBeenCalled();
    // The session should NOT have gone through AgentSession.start (that path
    // is for newSession-driven creates). Warm adoption uses the constructor
    // directly.
    expect(sessionCreateSpy).not.toHaveBeenCalled();
    // No fresh backend was created either — descriptor.createBackendProcess
    // is the spawn primitive.
    expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
    // Active session is the warm one.
    expect(mgr.getActiveSession()).not.toBeNull();
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("falls back to a fresh spawn when no warm entry is available", async () => {
    // takeWarm returning null is the second-and-later session path.
    const mgr = buildManager();
    await mgr.createSession();

    // No warm entry → start() runs on the freshly-created backend.
    expect(mockBackendStart).toHaveBeenCalledTimes(1);
    // AgentSession.start was used, not the construct-with-state branch.
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSessionManager preload status", () => {
  it("isPreloadReady reports per-backend; a missing entry is treated as ready", () => {
    const mgr = buildManager();
    // Unregistered backend → ready (so the chat doesn't stall waiting on a
    // preload that will never run).
    expect(mgr.isPreloadReady("opencode")).toBe(true);
    expect(mgr.getPreloadStatus("opencode")).toBe("absent");
  });

  it("transitions pending → ready on promise resolution and ready → ready stays ready", async () => {
    const mgr = buildManager();
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    mgr.registerPreload("opencode", promise);
    expect(mgr.getPreloadStatus("opencode")).toBe("pending");
    expect(mgr.isPreloadReady("opencode")).toBe(false);
    resolve();
    await promise;
    await Promise.resolve();
    expect(mgr.getPreloadStatus("opencode")).toBe("ready");
    expect(mgr.isPreloadReady("opencode")).toBe(true);
  });

  it("transitions pending → error on promise rejection but still reports ready (chat unblocks)", async () => {
    const mgr = buildManager();
    const rejection = new Error("preload failed");
    mgr.registerPreload(
      "opencode",
      Promise.reject(rejection).catch((e) => {
        throw e;
      })
    );
    // Microtask flush.
    await new Promise((r) => window.setTimeout(r, 0));
    expect(mgr.getPreloadStatus("opencode")).toBe("error");
    // The chat treats error as "ready enough" so the user isn't stuck on
    // a perpetual spinner; the picker shows the failure row.
    expect(mgr.isPreloadReady("opencode")).toBe(true);
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

describe("AgentSessionManager.restartBackend", () => {
  it("returns false when the backend has not been started", async () => {
    const mgr = buildManager();

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(false);
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("refreshes a warm preload probe when the manager owns no process yet", async () => {
    // Repro for the BYOK key-add bug: opencode was only preloaded (warm proc
    // held by the preloader, never adopted into a session), so the provider
    // restart no-oped and the stale probe's catalog made the picker flag the
    // freshly-keyed model "not offered by agent" until a full reload.
    const refresh = jest.fn(() => Promise.resolve());
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => ({ model: null, mode: null })),
      preload: jest.fn(async () => undefined),
      refresh,
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
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

    // The preloader owns the clear+re-probe (and its coalescing); the manager
    // just delegates to `refresh` and registers the returned probe.
    await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith("opencode");
    // No session was ever created, so no proc to shut down.
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("does not refresh a warm probe when nothing was preloaded", async () => {
    // Backend is installed, but the preloader has nothing warm/in-flight, so
    // `refresh` returns null and the manager must not spin a probe up.
    const refresh = jest.fn(() => null);
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      refresh,
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
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

    await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledWith("opencode");
  });

  it("re-probes after restart when no replacement session is created", async () => {
    // Proc exists but no active session is on this backend (e.g. the active
    // tab is on a different agent). The torn-down proc leaves nothing to
    // repopulate the cache, so the manager must re-probe — otherwise the
    // picker flags freshly-enabled models "not offered by agent" until reload.
    const preload = jest.fn(async () => undefined);
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => null),
      preload,
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
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

    // Create then close a session so the proc stays up with no active session.
    const session = await mgr.createSession();
    await mgr.closeSession(session.internalId);
    preload.mockClear();

    await expect(mgr.restartBackend("opencode", "byok save")).resolves.toBe(true);

    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(preload).toHaveBeenCalledWith("opencode");
  });

  it("restarts an idle backend and replaces the active affected session", async () => {
    const mgr = buildManager();
    const first = await mgr.createSession();

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);

    expect(mockSessionCancel).toHaveBeenCalledWith();
    expect(mockSessionDispose).toHaveBeenCalledWith();
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getSessions()).toHaveLength(1);
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("defers restart until an active turn leaves running", async () => {
    const mgr = buildManager();
    const first = await mgr.createSession();
    getSessionTestHandle(first).setStatus("running");

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);
    expect(mockBackendShutdown).not.toHaveBeenCalled();

    getSessionTestHandle(first).setStatus("idle");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("queues a second concurrent restart so the latest settings are not lost", async () => {
    // Repro: a single BYOK save fires many provider/model events that each
    // call restartBackend. Without queueing, only the first restart's
    // buildOpencodeConfig snapshot wins and later writes are silently
    // dropped. We model the work by stalling proc.shutdown until both
    // restartBackend calls have started, then asserting that the backend
    // is torn down twice (so the second restart actually ran with the
    // post-second-write snapshot).
    const mgr = buildManager();
    await mgr.createSession();

    // Block the first shutdown so both restart calls overlap. The second
    // call hits restartingBackends.has() === true and must enqueue.
    let releaseShutdown!: () => void;
    const shutdownStarted = new Promise<void>((resolveStarted) => {
      mockBackendShutdown.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            resolveStarted();
            releaseShutdown = () => resolve(undefined);
          })
      );
    });

    const first = mgr.restartBackend("opencode", "byok save #1");
    await shutdownStarted;
    const second = mgr.restartBackend("opencode", "byok save #2");
    releaseShutdown();
    await Promise.all([first, second]);
    // The queued re-run schedules itself in a finally; flush it.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // First call's shutdown + the queued re-run's shutdown = 2.
    expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSessionManager attention tracking", () => {
  it("flags a backgrounded session that finishes a turn", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    // b is active by default; switch to a so b runs in the background.
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(true);
    expect(a.getNeedsAttention()).toBe(false);
  });

  it("flags a backgrounded session that errors out", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("error");
    expect(b.getNeedsAttention()).toBe(true);
  });

  it("flags a backgrounded session that pauses for permission", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("awaiting_permission");
    expect(b.getNeedsAttention()).toBe(true);
  });

  it("does not flag the active session", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    expect(mgr.getActiveSession()).toBe(a);
    const aHandle = getSessionTestHandle(a);
    aHandle.setStatus("running");
    aHandle.setStatus("idle");
    expect(a.getNeedsAttention()).toBe(false);
  });

  it("does not flag the starting → idle transition", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    // simulate a fresh boot (mock starts at idle, force a starting → idle).
    bHandle.setStatus("starting");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(false);
  });

  it("clears the flag when the user activates the tab", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(true);
    mgr.setActiveSession(b.internalId);
    expect(b.getNeedsAttention()).toBe(false);
  });
});

describe("AgentSessionManager.replaceSessionInPlace", () => {
  // Drains the fire-and-forget `closeSession` chain that
  // replaceSessionInPlace kicks off, so assertions about pool removal
  // and dispose can run synchronously after.
  async function flushBackgroundClose(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it("inserts the replacement at the old session's tab-strip index", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    const c = await mgr.createSession();
    // Replace the middle tab — the regression case is "new chat hijacks
    // a sibling slot" because the new session is appended at the end.
    const replacement = await mgr.replaceSessionInPlace(b.internalId);
    await flushBackgroundClose();
    expect(mgr.getSessions()).toEqual([a, replacement, c]);
    expect(mgr.getActiveSession()).toBe(replacement);
  });

  it("preserves the leftmost slot when replacing the first tab", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const replacement = await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mgr.getSessions()).toEqual([replacement, b]);
    expect(mgr.getActiveSession()).toBe(replacement);
  });

  it("closes the old session in the background", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mockSessionCancel).toHaveBeenCalled();
    expect(mockSessionDispose).toHaveBeenCalled();
    expect(mgr.getSessions().some((s) => s.internalId === a.internalId)).toBe(false);
  });

  it("forwards the explicit backendId to createSession", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    await mgr.replaceSessionInPlace(a.internalId, "opencode");
    // The mocked AgentSession.start records the backendId on the session,
    // so we can assert it landed on the replacement.
    const replacement = mgr.getActiveSession();
    expect(replacement?.backendId).toBe("opencode");
  });

  it("falls back to plain create when the old id is unknown", async () => {
    const mgr = buildManager();
    const replacement = await mgr.replaceSessionInPlace("does-not-exist");
    expect(mgr.getSessions()).toEqual([replacement]);
    expect(mgr.getActiveSession()).toBe(replacement);
  });

  it("the replacement also takes the chatUIState slot at the same index", async () => {
    // The chatUIStates map is parallel to sessions — if it isn't reordered
    // alongside, getActiveChatUIState would point at the wrong session.
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const replacement = await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mgr.getActiveChatUIState()).toBe(mgr.getChatUIState(replacement.internalId));
    expect(mgr.getChatUIState(b.internalId)).not.toBeNull();
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

describe("AgentSessionManager.applySelection", () => {
  it("no-ops when no session is active", async () => {
    const mgr = buildManager();
    await expect(
      mgr.applySelection({ effort: "high" }, { expectBackendId: "opencode" })
    ).resolves.toBeUndefined();
  });

  it("no-ops when the active session is on a different backend", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    // Active session is on `opencode`; asking for a different backend
    // must refuse so a stray cross-backend apply can't slip through.
    await expect(
      mgr.applySelection({ effort: "high" }, { expectBackendId: "claude" })
    ).resolves.toBeUndefined();
  });

  it("delegates dispatch to descriptor.applySelection with the resolved selection", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = {
      id: "opencode",
      displayName: "opencode",
      getInstallState: jest.fn(),
      subscribeInstallState: jest.fn(),
      openInstallUI: jest.fn(),
      createBackendProcess: jest.fn(() => makeMockBackendProcess()),
      wire: {
        encode: ({ baseModelId, effort }: { baseModelId: string; effort: string | null }) =>
          effort ? `${baseModelId}/${effort}` : baseModelId,
        decode: (id: string) => ({
          selection: { baseModelId: id, effort: null },
          provider: null,
        }),
      },
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
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
    const entry = {
      baseModelId: "anthropic/sonnet",
      name: "Sonnet",
      provider: "anthropic",
      effortOptions: [
        { value: null, label: "Default" },
        { value: "high", label: "High" },
      ],
    };
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getState: () => unknown }).getState = () => ({
        model: {
          current: { baseModelId: entry.baseModelId, effort: null },
          availableModels: [entry],
        },
        mode: null,
      });
      return s;
    });
    const session = await mgr.createSession();

    // Effort-only patch: baseModelId resolves from current state.
    (mockedSetSettings as jest.Mock).mockClear();
    await mgr.applySelection({ effort: "high" }, { expectBackendId: "opencode" });
    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "anthropic/sonnet",
      effort: "high",
    });
    // Resolved selection is also persisted to settings.
    const persistedAfterEffort = readPersistedDefault(mockedSetSettings as jest.Mock, "opencode");
    expect(persistedAfterEffort).toEqual({
      baseModelId: "anthropic/sonnet",
      effort: "high",
    });

    // Full patch: both fields land verbatim.
    applySelectionMock.mockClear();
    (mockedSetSettings as jest.Mock).mockClear();
    await mgr.applySelection({ baseModelId: "anthropic/opus", effort: null });
    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "anthropic/opus",
      effort: null,
    });
    const persistedAfterFull = readPersistedDefault(mockedSetSettings as jest.Mock, "opencode");
    expect(persistedAfterFull).toEqual({
      baseModelId: "anthropic/opus",
      effort: null,
    });
  });

  it("does not persist when the descriptor's applySelection throws", async () => {
    const applySelectionMock = jest.fn(async () => {
      throw new Error("nope");
    });
    const descriptor = {
      id: "opencode",
      displayName: "opencode",
      getInstallState: jest.fn(),
      subscribeInstallState: jest.fn(),
      openInstallUI: jest.fn(),
      createBackendProcess: jest.fn(() => makeMockBackendProcess()),
      wire: {
        encode: ({ baseModelId }: { baseModelId: string }) => baseModelId,
        decode: (id: string) => ({
          selection: { baseModelId: id, effort: null },
          provider: null,
        }),
      },
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
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
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getState: () => unknown }).getState = () => ({
        model: {
          current: { baseModelId: "anthropic/sonnet", effort: null },
          availableModels: [
            { baseModelId: "anthropic/sonnet", name: "Sonnet", provider: null, effortOptions: [] },
          ],
        },
        mode: null,
      });
      return s;
    });
    await mgr.createSession();
    (mockedSetSettings as jest.Mock).mockClear();
    await expect(
      mgr.applySelection({ baseModelId: "anthropic/opus", effort: "high" })
    ).rejects.toThrow("nope");
    // No persistence after a failed apply.
    expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toBeUndefined();
  });
});

describe("AgentSessionManager.onInstallStateChanged", () => {
  // Builds a manager whose install state is mutable mid-test (mirrors a user
  // applying/clearing a binary path) and exposes the preloader spies.
  function buildInstallStateManager(opts: {
    installed: boolean;
    cachedState?: unknown;
    refreshResult?: Promise<void> | null;
  }) {
    let installed = opts.installed;
    const preloader = {
      getCachedBackendState: jest.fn(() => opts.cachedState ?? null),
      preload: jest.fn(async () => undefined),
      refresh: jest.fn(() => opts.refreshResult ?? null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: installed ? "ready" : "absent" })),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: preloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    return { mgr, preloader, setInstalled: (v: boolean) => (installed = v) };
  }

  it("preloads a freshly-installed backend that was never probed", async () => {
    // Newly installed: nothing warm, nothing live. `restartBackend` returns
    // false, so the manager must kick a first preload — without it the picker
    // would stay empty until a plugin reload.
    const { mgr, preloader } = buildInstallStateManager({ installed: true });

    await mgr.onInstallStateChanged("opencode");

    expect(preloader.preload).toHaveBeenCalledWith("opencode");
    expect(preloader.clearCached).not.toHaveBeenCalled();
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("refreshes a warm probe against the new binary without a fresh preload", async () => {
    // A warm probe (from load-time preload) carries the old binary; re-probe
    // it rather than spinning up a second one.
    const { mgr, preloader } = buildInstallStateManager({
      installed: true,
      cachedState: { model: null, mode: null },
      refreshResult: Promise.resolve(),
    });

    await mgr.onInstallStateChanged("opencode");

    expect(preloader.refresh).toHaveBeenCalledWith("opencode");
    expect(preloader.preload).not.toHaveBeenCalled();
  });

  it("restarts a live backend against the new binary", async () => {
    const { mgr, preloader } = buildInstallStateManager({ installed: true });
    await mgr.createSession();
    mockBackendShutdown.mockClear();
    preloader.preload.mockClear();

    await mgr.onInstallStateChanged("opencode");

    // The old proc is torn down (re-probe). No standalone preload — the restart
    // path repopulates the cache itself.
    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(preloader.preload).not.toHaveBeenCalled();
  });

  it("tears down and drops the warm probe when the binary is no longer available", async () => {
    const { mgr, preloader, setInstalled } = buildInstallStateManager({ installed: true });
    await mgr.createSession();
    mockBackendShutdown.mockClear();
    sessionCreateSpy.mockClear();

    // Path cleared / binary removed.
    setInstalled(false);
    await mgr.onInstallStateChanged("opencode");

    expect(mockBackendShutdown).toHaveBeenCalled();
    // No replacement session is spawned for an uninstalled backend.
    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(preloader.clearCached).toHaveBeenCalledWith("opencode");
    expect(preloader.preload).not.toHaveBeenCalled();
  });
});

/**
 * Walk through `setSettings` calls (each carries an updater function) and
 * return the most recent `defaultModel` written for `backendId`.
 */
function readPersistedDefault(
  setSettings: jest.Mock,
  backendId: string
): { baseModelId: string; effort: string | null } | undefined {
  let backends: Record<string, { defaultModel?: { baseModelId: string; effort: string | null } }> =
    {};
  for (const call of setSettings.mock.calls) {
    const updater = call[0];
    if (typeof updater !== "function") continue;
    const patch = updater({ agentMode: { backends } });
    if (patch?.agentMode?.backends) {
      backends = { ...backends, ...patch.agentMode.backends };
    }
  }
  return backends[backendId]?.defaultModel;
}
