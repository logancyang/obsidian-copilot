/**
 * Pool-semantics tests for AgentSessionManager. The shared backend
 * subprocess and the AgentSession factory are mocked so we can exercise
 * session-pool invariants without touching ACP or spawning a child process.
 */
import { FileSystemAdapter, App, TFile } from "obsidian";
import { AgentSession } from "./AgentSession";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { AgentSessionIndex } from "./AgentSessionIndex";
import { AgentSessionManager } from "./AgentSessionManager";
import { GLOBAL_SCOPE } from "./scope";
import {
  getSettings as mockedGetSettings,
  setSettings as mockedSetSettings,
} from "@/settings/model";
import * as projectsState from "@/projects/state";
import {
  ensureProjectContextMaterialized,
  type ContextMaterializeProgress,
} from "@/context/projectContextMaterializer";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  agentProjectContextLoadAtom,
  type AgentProjectContextLoadState,
  type ProjectConfig,
} from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import { getProjectContextSignature } from "@/projects/projectContextSignature";
import type { BackendDescriptor } from "./types";

const mockEnsureMaterialized = ensureProjectContextMaterialized as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Captured `subscribeToSettingsChange` callbacks, so a test can drive a
// settings change and assert the manager's reaction.
const settingsChangeCallbacks = new Set<
  (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void
>();

// Stub the project-folder mirror so a non-global spawn never touches the vault.
jest.mock("@/projects/ensureAgentsMirror", () => ({
  ensureAgentsMirror: jest.fn(async () => undefined),
}));

// MRU touch is fire-and-forget through the singleton; mock it so enterProject
// tests assert the call without real frontmatter IO.
const mockTouchProjectLastUsed = jest.fn(async () => undefined);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(() => ({ touchProjectLastUsed: mockTouchProjectLastUsed })),
  },
}));

// Stub context materialization so a non-global create / background warm never
// hits brevilabs or the disk. The result faithfully carries the CAPTURED
// signature of the live record (what the real materializer returns), so the
// dirty-clear path behaves realistically; a spy so warm calls can be asserted.
jest.mock("@/context/projectContextMaterializer", () => {
  const { getProjectContextSignature } = jest.requireActual("@/projects/projectContextSignature");
  const { getCachedProjectRecordById } = jest.requireActual("@/projects/state");
  return {
    ensureProjectContextMaterialized: jest.fn(async (_app: unknown, projectId: string) => {
      const record = getCachedProjectRecordById(projectId);
      return {
        additionalDirectories: [],
        contextSignature: record ? getProjectContextSignature(record) : undefined,
      };
    }),
    EMPTY_CONTEXT_MATERIALIZATION_RESULT: { additionalDirectories: [] },
  };
});

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    agentMode: { activeBackend: "opencode", backends: {} },
  })),
  setSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(
    (cb: (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void) => {
      settingsChangeCallbacks.add(cb);
      return () => settingsChangeCallbacks.delete(cb);
    }
  ),
  // Minimal jotai-store shim: a non-global spawn publishes context-load state
  // through it (beginContextMaterialization). `get` returns an empty map so the
  // first publish "owns" the flight; `set` is a no-op spy.
  settingsStore: { get: jest.fn(() => ({})), set: jest.fn() },
}));

/** Fire the manager's settings subscription with a before/after pair. */
function emitSettingsChange(prev: { agentMode: unknown }, next: { agentMode: unknown }): void {
  for (const cb of settingsChangeCallbacks) cb(prev, next);
}

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
  /** Seed the display messages so a manual save writes a file (and a path). */
  setMessages(messages: { message: string }[]): void;
  /** Toggle whether the session reports user-visible messages (detach gating). */
  setHasUserVisibleMessages(value: boolean): void;
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
  projectId?: string;
  ready?: Promise<void>;
}): AgentSession {
  const sessionId = overrides.backendSessionId ?? `backend-${nextBackendSessionId++}`;
  let status: "starting" | "idle" | "running" | "awaiting_permission" | "error" | "closed" = "idle";
  let needsAttention = false;
  let displayMessages: { message: string }[] = [];
  let hasUserVisibleMessages = false;
  const listeners = new Set<{
    onStatusChanged?: (s: typeof status) => void;
    onNeedsAttentionChanged?: (v: boolean) => void;
  }>();
  const session = {
    internalId: overrides.internalId,
    backendId: overrides.backendId,
    projectId: overrides.projectId ?? GLOBAL_SCOPE,
    ready: overrides.ready ?? Promise.resolve(),
    getBackendSessionId: () => sessionId,
    getStatus: () => status,
    store: { getDisplayMessages: () => displayMessages },
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
    hasUserVisibleMessages: () => hasUserVisibleMessages,
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
    setMessages: (messages) => {
      displayMessages = messages;
    },
    setHasUserVisibleMessages: (value) => {
      hasUserVisibleMessages = value;
    },
  });
  return session;
}

const sessionCreateSpy = jest.spyOn(AgentSession, "start").mockImplementation((opts) =>
  makeMockSession({
    internalId: opts.internalId,
    backendId: opts.backendId,
    projectId: opts.projectId,
  })
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
    // opencode runs a title summarizer, so native title discovery trusts it.
    summarizesSessionTitle: true,
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
    getWarmProcs: jest.fn(() => []),
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
  // Managers from prior tests never shut down, so their settings
  // subscriptions linger; clear them so emitSettingsChange only reaches
  // the manager built in the current test.
  settingsChangeCallbacks.clear();
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
      getWarmProcs: jest.fn(() => []),
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

  it("seeds the catalog native default when no explicit default is stored", async () => {
    // Regression: a warm/running subprocess bakes its model from the default
    // at spawn time. After the default is cleared, getDefaultSelection is null,
    // so without this fallback a fresh "Agent default" chat would inherit the
    // stale baked model. The new session must be confirmed onto the native
    // catalog default instead.
    const probeState = {
      model: {
        current: { baseModelId: "opencode/old-baked", effort: null },
        availableModels: [
          { baseModelId: "opencode/native", name: "Native", provider: null, effortOptions: [] },
        ],
      },
      mode: null,
    };
    const descriptor = buildDescriptor();
    const modelPreloader = {
      getCachedBackendState: jest.fn(() => probeState),
      preload: jest.fn(async () => undefined),
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
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
    expect(sessionCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModelSelection: { baseModelId: "opencode/native", effort: null },
      })
    );
  });

  it("leaves the seed unset when no default is stored and no catalog is probed", async () => {
    // With nothing baked we have no native id to target, so the seed stays
    // undefined and the session inherits the backend's own native behavior.
    const mgr = buildManager();
    await mgr.createSession();
    expect(sessionCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModelSelection: undefined })
    );
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

describe("AgentSessionManager warm-backend reuse", () => {
  const probeState = {
    model: {
      current: { baseModelId: "anthropic/sonnet", effort: null },
      availableModels: [
        { baseModelId: "anthropic/sonnet", name: "Sonnet", provider: null, effortOptions: [] },
      ],
    },
    mode: null,
  };

  // Build a manager whose preloader hands out exactly one warm proc (with a
  // persisted probe session id) on the first `takeWarm`, then null.
  function buildManagerWithWarm(warmProc: ReturnType<typeof makeMockBackendProcess>) {
    const descriptor = buildDescriptor();
    const takeWarmMock = jest
      .fn()
      .mockReturnValueOnce({ proc: warmProc, probeSessionId: "probe-1", state: probeState })
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
    return { mgr, descriptor };
  }

  it("reuses the preloader's warm proc instead of spawning a fresh one", async () => {
    const warmProc = makeMockBackendProcess();
    const { mgr, descriptor } = buildManagerWithWarm(warmProc);

    await mgr.createSession();

    // start() on the warm proc must not be re-invoked — preload already did it.
    expect(mockBackendStart).not.toHaveBeenCalled();
    // No fresh backend was created either — descriptor.createBackendProcess
    // is the spawn primitive.
    expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
    // Active session is the warm one.
    expect(mgr.getActiveSession()).not.toBeNull();
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("starts a fresh session on the warm proc instead of adopting the probe session", async () => {
    // Regression guard for the opencode "new chat replays prior conversation"
    // bug: opencode resumes its persisted probe session (transcript + title
    // intact), so the warm probe's *session* must never be adopted as the
    // user's chat — only the subprocess is reused.
    const warmProc = makeMockBackendProcess();
    const { mgr } = buildManagerWithWarm(warmProc);

    await mgr.createSession();

    // The chat went through the newSession-driven start path, on the warm proc.
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const opts = sessionCreateSpy.mock.calls[0][0];
    expect(opts.backend).toBe(warmProc);
    // The probe session id is never threaded in as a session to adopt.
    expect(opts).not.toHaveProperty("backendSessionId");
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
      getWarmProcs: jest.fn(() => []),
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
      getWarmProcs: jest.fn(() => []),
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
      getWarmProcs: jest.fn(() => []),
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

  it("re-probes before creating the replacement so the effort catalog is rebuilt", async () => {
    // The active tab is on this backend, so the restart creates a replacement
    // session. `restartBackendNow` cleared the (now stale) effort catalog, and
    // a live session's attachModelCacheSync mirrors catalog state but NOT the
    // effort catalog — so the manager must re-probe before the replacement, or
    // the picker loses every model's effort stepper until a reload.
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
      getWarmProcs: jest.fn(() => []),
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

    const first = await mgr.createSession();
    // Drop the initial-create probe/spawn bookkeeping so we assert only on the
    // restart's re-probe + replacement ordering.
    preload.mockClear();
    sessionCreateSpy.mockClear();

    await expect(mgr.restartBackend("opencode", "backend enabled models changed")).resolves.toBe(
      true
    );

    // Re-probed once, and the probe ran before the replacement session spawned.
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledWith("opencode");
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(preload.mock.invocationCallOrder[0]).toBeLessThan(
      sessionCreateSpy.mock.invocationCallOrder[0]
    );
    // The replacement still becomes the active session on this backend.
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

describe("AgentSessionManager.getRunningChatIds", () => {
  // A manager whose saveSession returns a stable on-disk path, so we can drive
  // a session into the "saved" (markdown path) recent-list identity.
  function buildManagerWithPersistence(): AgentSessionManager {
    const descriptor = buildDescriptor();
    const persistence = {
      saveSession: jest.fn(async () => ({ path: "chats/agent__saved.md" })),
    };
    return new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: {
          getCachedBackendState: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => null),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          setCached: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => []),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
        persistenceManager: persistence as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["persistenceManager"],
      }
    );
  }

  it("returns the same frozen empty set when nothing is running", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    getSessionTestHandle(a).setStatus("idle");
    const first = mgr.getRunningChatIds();
    expect(first.size).toBe(0);
    // Referential stability: an empty result must reuse the module constant.
    expect(mgr.getRunningChatIds()).toBe(first);
  });

  it("keys a running saved session by its markdown path", async () => {
    const mgr = buildManagerWithPersistence();
    const a = await mgr.createSession();
    getSessionTestHandle(a).setMessages([{ message: "hi" }]);
    await mgr.saveActiveSession();
    getSessionTestHandle(a).setStatus("running");
    expect(mgr.getRunningChatIds().has("chats/agent__saved.md")).toBe(true);
  });

  it("keys a running native session by its native chat id", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    getSessionTestHandle(a).setStatus("running");
    const expected = buildNativeChatId(a.backendId, a.getBackendSessionId()!);
    expect(mgr.getRunningChatIds().has(expected)).toBe(true);
  });

  it("excludes idle / starting / closed sessions", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    getSessionTestHandle(a).setStatus("running");
    getSessionTestHandle(b).setStatus("starting");
    const ids = mgr.getRunningChatIds();
    expect(ids.has(buildNativeChatId(a.backendId, a.getBackendSessionId()!))).toBe(true);
    expect(ids.has(buildNativeChatId(b.backendId, b.getBackendSessionId()!))).toBe(false);
  });

  it("notifies subscribers when a session's running membership flips", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const listener = jest.fn();
    mgr.subscribe(listener);
    getSessionTestHandle(a).setStatus("running");
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    getSessionTestHandle(a).setStatus("idle");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps both ids when a running session's first save re-keys it (dual-id)", async () => {
    const mgr = buildManagerWithPersistence();
    const a = await mgr.createSession();
    getSessionTestHandle(a).setMessages([{ message: "hi" }]);
    getSessionTestHandle(a).setStatus("running");
    // Before the save the running session is keyed by its native id.
    const nativeId = buildNativeChatId(a.backendId, a.getBackendSessionId()!);
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);

    const listener = jest.fn();
    mgr.subscribe(listener);
    await mgr.saveActiveSession();

    // The save itself must not notify (autosave stays decoupled from row
    // visibility). Instead the set now carries BOTH ids, so whichever id the
    // mounted list rendered the row under, `.has()` still hits.
    expect(listener).not.toHaveBeenCalled();
    const ids = mgr.getRunningChatIds();
    expect(ids.has("chats/agent__saved.md")).toBe(true);
    expect(ids.has(nativeId)).toBe(true);
  });
});

describe("AgentSessionManager.getAttentionChatIds", () => {
  it("returns the same frozen empty set when nothing needs attention", async () => {
    const mgr = buildManager();
    await mgr.createSession();
    const first = mgr.getAttentionChatIds();
    expect(first.size).toBe(0);
    expect(mgr.getAttentionChatIds()).toBe(first);
  });

  it("hands a backgrounded finished session over from running to attention", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    // b is active by default; switch to a so b runs in the background.
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    const nativeId = buildNativeChatId(b.backendId, b.getBackendSessionId()!);

    bHandle.setStatus("running");
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);

    // Finishing in the background: the id must leave the running set and
    // enter the attention set in the same status flip — the row's spinner
    // hands off to the live done-dot without a history reload.
    bHandle.setStatus("idle");
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
  });

  it("does not include the active session (it never flags attention)", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const aHandle = getSessionTestHandle(a);
    aHandle.setStatus("running");
    aHandle.setStatus("idle");
    expect(mgr.getAttentionChatIds().size).toBe(0);
  });

  it("drops the id once the user activates the flagged tab", async () => {
    const mgr = buildManager();
    const a = await mgr.createSession();
    const b = await mgr.createSession();
    mgr.setActiveSession(a.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    const nativeId = buildNativeChatId(b.backendId, b.getBackendSessionId()!);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
    mgr.setActiveSession(b.internalId);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);
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
      getWarmProcs: jest.fn(() => []),
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
    // A chat pick is transient: it never writes the durable default.
    expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toBeUndefined();

    // Full patch: both fields land verbatim on the descriptor, still no persist.
    applySelectionMock.mockClear();
    (mockedSetSettings as jest.Mock).mockClear();
    await mgr.applySelection({ baseModelId: "anthropic/opus", effort: null });
    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "anthropic/opus",
      effort: null,
    });
    expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toBeUndefined();
  });
});

describe("AgentSessionManager default-model settings subscription", () => {
  // The per-session apply chain hops through several resolved promises
  // (prior link → session.ready → apply). Drain enough microtasks that a
  // synchronous assertion sees the apply.
  async function flushApplyChain(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }

  function makeApplySelectionDescriptor(applySelectionMock: jest.Mock): BackendDescriptor {
    return {
      id: "opencode",
      displayName: "opencode",
      getInstallState: jest.fn(),
      subscribeInstallState: jest.fn(),
      openInstallUI: jest.fn(),
      createBackendProcess: jest.fn(() => makeMockBackendProcess()),
      wire: {
        encode: ({ baseModelId }: { baseModelId: string }) => baseModelId,
        decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
      },
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
  }

  function makeStubPreloader(cachedState: unknown = null) {
    return {
      getCachedBackendState: jest.fn(() => cachedState),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      setCached: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
  }

  it("re-applies a changed default to a live session on that backend", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const session = await mgr.createSession();

    const prev = { agentMode: { backends: { opencode: { defaultModel: null } } } };
    const next = {
      agentMode: {
        backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
      },
    };
    // The re-apply re-reads the live default at run time, so reflect it here.
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", ...next.agentMode },
    });
    emitSettingsChange(prev, next);
    await flushApplyChain();

    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "opus",
      effort: "high",
    });
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
  });

  it("ignores an unchanged default and other backends' changes", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    await mgr.createSession();

    const same = { baseModelId: "opus", effort: "high" };
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: same } } } },
      { agentMode: { backends: { opencode: { defaultModel: { ...same } } } } }
    );
    // A different backend's default changing must not touch the opencode session.
    emitSettingsChange(
      { agentMode: { backends: { claude: { defaultModel: null } } } },
      { agentMode: { backends: { claude: { defaultModel: { baseModelId: "x", effort: null } } } } }
    );
    expect(applySelectionMock).not.toHaveBeenCalled();
  });

  it("reverts a live session to the agent's native default when the default is cleared", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    // A probed catalog whose first model is the agent's native default.
    const cachedState = {
      model: {
        current: { baseModelId: "native", effort: null },
        apply: { kind: "setModel" },
        availableModels: [
          { baseModelId: "native", name: "Native", provider: "x", effortOptions: [] },
        ],
      },
      mode: null,
    };
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader(cachedState) as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const session = await mgr.createSession();

    // User picks "Agent default" → stored default goes from explicit to null.
    emitSettingsChange(
      {
        agentMode: {
          backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
        },
      },
      { agentMode: { backends: { opencode: { defaultModel: null } } } }
    );
    await flushApplyChain();

    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "native",
      effort: null,
    });
  });

  it("defers re-apply for a starting session until ready, using the latest default", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    // A session that is still starting (no backend session id yet) would throw
    // from setModel/setConfigOption, so the re-apply must wait on `ready`.
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const session = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      Object.defineProperty(session, "ready", { value: ready });
      getSessionTestHandle(session).setStatus("starting");
      return session;
    });
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const session = await mgr.createSession();

    const latest = { baseModelId: "opus", effort: "low" };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: latest } } },
    });
    emitSettingsChange(
      {
        agentMode: {
          backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
        },
      },
      { agentMode: { backends: { opencode: { defaultModel: latest } } } }
    );

    // Nothing applied while the session is still starting.
    await flushApplyChain();
    expect(applySelectionMock).not.toHaveBeenCalled();

    resolveReady();
    await ready;
    await flushApplyChain();

    expect(applySelectionMock).toHaveBeenCalledWith(session, latest);
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
  });

  it("serializes rapid default changes and commits the latest", async () => {
    // Two changes land before the first applySelection round-trip settles.
    // The applies must run in order and re-read the live default, so the last
    // value wins rather than an out-of-order round-trip leaving a stale model.
    const order: string[] = [];
    let resolveFirst: () => void = () => {};
    const applySelectionMock = jest.fn(
      async (_session: AgentSession, sel: { baseModelId: string }) => {
        order.push(sel.baseModelId);
        if (order.length === 1) await new Promise<void>((r) => (resolveFirst = r));
      }
    );
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    await mgr.createSession();

    const first = { baseModelId: "first", effort: null };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: first } } },
    });
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: null } } } },
      { agentMode: { backends: { opencode: { defaultModel: first } } } }
    );
    await flushApplyChain();

    // Second change arrives while the first apply is mid-flight.
    const second = { baseModelId: "second", effort: null };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: second } } },
    });
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: first } } } },
      { agentMode: { backends: { opencode: { defaultModel: second } } } }
    );
    await flushApplyChain();

    // The second apply is still queued behind the in-flight first one.
    expect(order).toEqual(["first"]);
    resolveFirst();
    await flushApplyChain();

    expect(order).toEqual(["first", "second"]);
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
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
      getWarmProcs: jest.fn(() => []),
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

    // The old proc is torn down and the backend re-probed: a live session
    // mirrors catalog state but not the derived effort catalog, so the restart
    // re-probes (the replacement then adopts that warm proc).
    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(preloader.preload).toHaveBeenCalledWith("opencode");
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

describe("AgentSessionManager chat history aggregation", () => {
  // The mapped obsidian mock's TFile is a jest constructor taking a path;
  // instances must come from the same constructor the production code
  // `instanceof`-checks against, hence the import (not jest.requireMock).
  const MockTFile = TFile as unknown as new (path: string) => TFile & {
    stat: { ctime: number; mtime: number };
  };

  interface FakeFrontmatter {
    epoch?: number;
    topic?: string;
    backendId?: string;
    sessionId?: string;
    lastAccessedAt?: number;
    projectId?: string;
  }

  function makeIndexStorage() {
    const files = new Map<string, string>();
    return {
      exists: async (p: string) => files.has(p),
      read: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      write: async (p: string, c: string) => {
        files.set(p, c);
      },
    };
  }

  function buildHistoryHarness(opts?: {
    files?: Record<string, FakeFrontmatter>;
    /** Hidden-folder files: never in the metadata cache, read via adapter. */
    hiddenFiles?: Record<string, string>;
    listSessions?: jest.Mock;
    /** When set, the preloader exposes a warm opencode probe proc with this listSessions. */
    warmListSessions?: jest.Mock;
    /** When set, the warm opencode probe proc answers this device's locality probe. */
    warmSessionExistsLocally?: jest.Mock;
    probeSessionId?: string;
    /** Defaults to true; set false to model a non-summarizing backend (codex). */
    summarizesSessionTitle?: boolean;
  }) {
    const frontmatterByPath = opts?.files ?? {};
    const hiddenByPath = opts?.hiddenFiles ?? {};
    const tfiles = [...Object.keys(frontmatterByPath), ...Object.keys(hiddenByPath)].map((p) => {
      const f = new MockTFile(p);
      f.stat = { ctime: 1_000, mtime: 1_000, size: 0 };
      return f;
    });
    const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
      "/vault"
    ) as { read: jest.Mock };
    adapter.read.mockImplementation(async (p: string) => {
      const content = hiddenByPath[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    });
    const app = {
      vault: {
        adapter,
        getAbstractFileByPath: (p: string) =>
          tfiles.find((f: { path: string }) => f.path === p) ?? null,
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => {
          const fm = frontmatterByPath[file.path];
          return fm ? { frontmatter: fm } : null;
        },
      },
    } as unknown as App;
    const plugin = {
      manifest: { version: "1.0.0" },
      getChatHistoryLastAccessedAtManager: () => ({
        getEffectiveLastUsedAt: (_path: string, fallback: number) => fallback,
      }),
    };
    const persistence = {
      getAgentChatHistoryFiles: jest.fn(async () => tfiles),
      updateTopic: jest.fn(async () => undefined),
      deleteFile: jest.fn(async () => undefined),
    };
    const index = new AgentSessionIndex(makeIndexStorage(), "plugins/copilot/index.json");
    const descriptor = {
      ...buildDescriptor(),
      summarizesSessionTitle: opts?.summarizesSessionTitle ?? true,
      getProbeSessionId: jest.fn(() => opts?.probeSessionId),
    } as unknown as BackendDescriptor;
    if (opts?.listSessions) {
      (descriptor as unknown as { createBackendProcess: jest.Mock }).createBackendProcess = jest.fn(
        () => ({ ...makeMockBackendProcess(), listSessions: opts.listSessions })
      );
    }
    const manager = new AgentSessionManager(
      app,
      plugin as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === "opencode" ? descriptor : undefined),
        modelPreloader: {
          getCachedBackendState: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => null),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          setCached: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => {
            if (!opts?.warmListSessions && !opts?.warmSessionExistsLocally) return [];
            const proc: Record<string, unknown> = { ...makeMockBackendProcess() };
            if (opts.warmListSessions) proc.listSessions = opts.warmListSessions;
            if (opts.warmSessionExistsLocally)
              proc.sessionExistsLocally = opts.warmSessionExistsLocally;
            return [{ backendId: "opencode", proc }];
          }),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
        persistenceManager: persistence as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["persistenceManager"],
        sessionIndex: index,
      }
    );
    return { manager, index, persistence };
  }

  it("merges markdown and native entries, de-duplicated on backend session id", async () => {
    const { manager, index } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          topic: "Saved chat",
          backendId: "opencode",
          sessionId: "s1",
          lastAccessedAt: 2_000,
        },
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Saved chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 5_000,
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s2",
      title: "Native only chat",
      createdAtMs: 3_000,
      lastAccessedAtMs: 4_000,
    });

    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(2);
    const markdown = items.find((i) => i.id === "chats/agent__a.md");
    expect(markdown).toBeDefined();
    // De-dup lifted the markdown item's recency to the fresher native side.
    expect(markdown?.lastAccessedAt.getTime()).toBe(5_000);
    const native = items.find((i) => i.id !== "chats/agent__a.md");
    expect(native?.id).toBe(buildNativeChatId("opencode", "s2"));
    expect(native?.title).toBe("Native only chat");
    expect(native?.backendId).toBe("opencode");
  });

  it("de-duplicates hidden-folder chats via the adapter frontmatter fallback", async () => {
    // Hidden save folders (e.g. under the config dir) are never indexed by
    // the metadata cache; the session ref must come from an adapter read or
    // the markdown row can't merge with its native twin.
    const { manager, index } = buildHistoryHarness({
      hiddenFiles: {
        ".copilot/chats/agent__hidden.md":
          '---\nepoch: 1000\nmode: agent\nbackendId: opencode\nsessionId: "s1"\n---\n\n**user**: hi',
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Hidden twin",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(".copilot/chats/agent__hidden.md");
  });

  it("lists native sessions when no markdown notes exist (autosave off)", async () => {
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "codex",
      sessionId: "s9",
      title: "Codex chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(buildNativeChatId("codex", "s9"));
  });

  it("scopes a project view's native entries by the index's recorded projectId", async () => {
    // Autosave-off project chats have no markdown frontmatter — the index's
    // recorded scope is the only thing that can place them in a project list.
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "codex",
      sessionId: "in-project",
      title: "Project chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
      projectId: "proj-1",
    });
    await index.recordSession({
      backendId: "codex",
      sessionId: "global-chat",
      title: "Global chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    const projectItems = await manager.getChatHistoryItems("proj-1");
    expect(projectItems).toHaveLength(1);
    expect(projectItems[0]?.id).toBe(buildNativeChatId("codex", "in-project"));

    // The global view stays the flat all-scopes list.
    expect(await manager.getChatHistoryItems()).toHaveLength(2);
  });

  it("deleting a native entry tombstones it without touching persistence", async () => {
    const { manager, index, persistence } = buildHistoryHarness();
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Doomed",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.deleteChatHistory(buildNativeChatId("opencode", "s1"));
    expect(await manager.getChatHistoryItems()).toHaveLength(0);
    expect(await index.isTombstoned("opencode", "s1")).toBe(true);
    expect(persistence.deleteFile).not.toHaveBeenCalled();
  });

  it("deleting a markdown chat also tombstones its native twin", async () => {
    const { manager, index, persistence } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          backendId: "opencode",
          sessionId: "s1",
        },
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Twin",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.deleteChatHistory("chats/agent__a.md");
    expect(persistence.deleteFile).toHaveBeenCalledWith("chats/agent__a.md");
    expect(await index.isTombstoned("opencode", "s1")).toBe(true);
  });

  it("renaming a native entry updates the index title", async () => {
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Old title",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.updateChatTitle(buildNativeChatId("opencode", "s1"), "New title");
    expect((await index.getEntry("opencode", "s1"))?.title).toBe("New title");
  });

  it("native rename matches the live session by backend, not session id alone", async () => {
    const { manager, index } = buildHistoryHarness();
    const live = await manager.createSession("opencode");
    const liveId = live.getBackendSessionId()!;
    await index.recordSession({
      backendId: "codex",
      sessionId: liveId,
      title: "Codex entry",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    // Renaming the codex native entry whose id collides with the live
    // opencode session must NOT relabel the opencode tab.
    await manager.updateChatTitle(buildNativeChatId("codex", liveId), "Codex renamed");
    expect((await index.getEntry("codex", liveId))?.title).toBe("Codex renamed");
    expect(live.setLabel).not.toHaveBeenCalled();
  });

  it("matches live sessions by the (backendId, sessionId) pair, not session id alone", async () => {
    const { manager } = buildHistoryHarness();
    const session = await manager.createSession("opencode");
    const liveId = session.getBackendSessionId()!;

    // Same backend + session id: focuses the existing tab.
    await expect(manager.loadNativeSessionFromHistory("opencode", liveId)).resolves.toBe(session);

    // Same session id on a DIFFERENT backend must not focus the opencode
    // tab — it falls through to the resume path (which here fails on the
    // unknown backend rather than silently hijacking the wrong session).
    await expect(manager.loadNativeSessionFromHistory("codex", liveId)).rejects.toThrow();
    expect(manager.getActiveSession()).toBe(session);
  });

  it("hides a markdown chat whose backend session is absent on this device", async () => {
    // A chat synced from another machine: its note (and session id) rides the
    // vault, but the backend's local transcript store does not — so resuming
    // it here would dead-end. It must not show in Recent Chats.
    const sessionExistsLocally = jest.fn(
      async ({ sessionId }: { sessionId: string }) => sessionId === "local"
    );
    const { manager } = buildHistoryHarness({
      files: {
        "chats/agent__local.md": {
          epoch: 2_000,
          topic: "Made here",
          backendId: "opencode",
          sessionId: "local",
        },
        "chats/agent__foreign.md": {
          epoch: 1_000,
          topic: "Made elsewhere",
          backendId: "opencode",
          sessionId: "foreign",
        },
      },
      warmSessionExistsLocally: sessionExistsLocally,
    });

    const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
    expect(titles).toContain("Made here");
    expect(titles).not.toContain("Made elsewhere");
    expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "foreign", cwd: "/vault" });
  });

  it("probes a project chat's resumability with its project cwd, not the vault root", async () => {
    // Regression: a backend that keys its transcript store by cwd (Claude) stores
    // a project chat's transcript under the PROJECT folder. Probing it with the
    // vault root would report a perfectly resumable local project chat as absent
    // and hide it. The locality probe must use the chat's own scope cwd.
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(
        async ({ cwd }: { cwd: string }) => cwd === "/vault/Projects/proj-1"
      );
      const { manager } = buildHistoryHarness({
        files: {
          "chats/agent__p.md": {
            epoch: 2_000,
            topic: "Project chat",
            backendId: "opencode",
            sessionId: "proj-sess",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });

      const titles = (await manager.getChatHistoryItems("proj-1")).map((i) => i.title);
      expect(titles).toContain("Project chat");
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "proj-sess",
        cwd: "/vault/Projects/proj-1",
      });
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("probes each chat with its own scope cwd in the global flat view", async () => {
    // The global Recent Chats view is a flat all-scopes list, so it must probe a
    // global chat against the vault root AND a project chat against its project
    // folder in the same pass — otherwise the project row gets wrongly hidden.
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(async () => true);
      const { manager } = buildHistoryHarness({
        files: {
          "chats/agent__g.md": {
            epoch: 2_000,
            topic: "Global chat",
            backendId: "opencode",
            sessionId: "g-sess",
          },
          "chats/agent__p.md": {
            epoch: 1_000,
            topic: "Project chat",
            backendId: "opencode",
            sessionId: "p-sess",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });

      const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
      expect(titles).toEqual(expect.arrayContaining(["Global chat", "Project chat"]));
      expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "g-sess", cwd: "/vault" });
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "p-sess",
        cwd: "/vault/Projects/proj-1",
      });
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("still hides a genuinely non-resumable project chat (probed against its project cwd)", async () => {
    // The fix must not over-correct: a project chat synced from another machine
    // is absent under its OWN project cwd too, so it stays hidden + tombstoned —
    // identical behavior to a non-resumable global chat, just with the right cwd.
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(async () => false);
      const { manager, index } = buildHistoryHarness({
        files: {
          "chats/agent__p.md": {
            epoch: 2_000,
            topic: "Foreign project chat",
            backendId: "opencode",
            sessionId: "foreign-proj",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });
      await index.recordSession({
        backendId: "opencode",
        sessionId: "foreign-proj",
        title: "Twin",
        createdAtMs: 1_000,
        lastAccessedAtMs: 2_000,
        projectId: "proj-1",
      });

      const titles = (await manager.getChatHistoryItems("proj-1")).map((i) => i.title);
      expect(titles).not.toContain("Foreign project chat");
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "foreign-proj",
        cwd: "/vault/Projects/proj-1",
      });
      // The native twin is tombstoned, same as the global non-resumable path.
      expect(await index.isTombstoned("opencode", "foreign-proj")).toBe(true);
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("tombstones the native twin of a dropped non-local markdown chat", async () => {
    // A normal autosaved chat has both a note AND a flushIndexTouch index
    // entry on its origin machine. When the note syncs to a second device but
    // the backend transcript doesn't, dropping the markdown row alone leaves
    // the index entry to resurface as a native-only row that still dead-ends.
    // The drop must tombstone the twin so the chat is fully removed.
    const sessionExistsLocally = jest.fn(async () => false);
    const { manager, index } = buildHistoryHarness({
      files: {
        "chats/agent__foreign.md": {
          epoch: 1_000,
          topic: "Made elsewhere",
          backendId: "opencode",
          sessionId: "foreign",
        },
      },
      warmSessionExistsLocally: sessionExistsLocally,
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "foreign",
      title: "Made elsewhere",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(0);
    expect(await index.isTombstoned("opencode", "foreign")).toBe(true);
  });

  it("keeps markdown chats when no running backend can confirm the session is absent", async () => {
    // No warm proc exposes the locality probe, so the manager can't prove the
    // session is foreign — it must keep the row rather than risk hiding a
    // local chat (e.g. backend not yet running).
    const { manager } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          topic: "Unknowable",
          backendId: "opencode",
          sessionId: "s1",
        },
      },
    });
    const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
    expect(titles).toContain("Unknowable");
  });

  it("sweeps the preloader's warm probe procs before any chat starts a backend", async () => {
    const warmListSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "pre-existing",
          cwd: "/vault",
          title: "Chat from before this app session",
          updatedAt: new Date(6_000).toISOString(),
        },
      ],
    }));
    const { manager } = buildHistoryHarness({ warmListSessions });
    // No createSession call: the manager owns no backend, only the warm
    // probe exists — the first Agent Home open must still surface history.
    const items = await manager.getChatHistoryItems();
    expect(warmListSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(buildNativeChatId("opencode", "pre-existing"));
  });

  it("sweeps running backends' listSessions into history, scoped to the vault cwd", async () => {
    const listSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "in-vault",
          cwd: "/vault",
          title: "Real chat",
          updatedAt: new Date(7_000).toISOString(),
        },
        { sessionId: "other-vault", cwd: "/elsewhere", title: "Foreign chat", updatedAt: null },
        { sessionId: "untitled", cwd: "/vault", title: null, updatedAt: null },
        { sessionId: "placeholder", cwd: "/vault", title: "New session - 1", updatedAt: null },
        { sessionId: "probe-1", cwd: "/vault", title: "Probe", updatedAt: null },
      ],
    }));
    const { manager } = buildHistoryHarness({ listSessions, probeSessionId: "probe-1" });
    // Spawning a session is what registers (and starts) the backend; the
    // sweep only ever queries already-running backends.
    await manager.createSession("opencode");

    const items = await manager.getChatHistoryItems();
    expect(listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    const native = items.filter((i) => i.id.startsWith("copilot-agent-session://"));
    expect(native).toHaveLength(1);
    expect(native[0]?.id).toBe(buildNativeChatId("opencode", "in-vault"));
    expect(native[0]?.title).toBe("Real chat");
    expect(native[0]?.lastAccessedAt.getTime()).toBe(7_000);
  });

  it("skips native title discovery for non-summarizing backends (codex)", async () => {
    // codex names a session after the raw first prompt, so its listSessions
    // title can leak the injected context envelope. The sweep must not trust it.
    const listSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "ctx-leak",
          cwd: "/vault",
          title: "<copilot-context> The user attached the following vault items",
          updatedAt: null,
        },
      ],
    }));
    const { manager } = buildHistoryHarness({ listSessions, summarizesSessionTitle: false });
    await manager.createSession("opencode");

    const items = await manager.getChatHistoryItems();
    expect(listSessions).not.toHaveBeenCalled();
    expect(items.filter((i) => i.id.startsWith("copilot-agent-session://"))).toHaveLength(0);
  });
});

describe("AgentSessionManager.enterProject MRU touch", () => {
  const PROJECT_ID = "proj-mru";
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTouchProjectLastUsed.mockClear();
    (ProjectFileManager.getInstance as jest.Mock).mockClear();
    // Make the scope resolvable: enterProject's orphan guard and resolveScopeCwd
    // both read this, so a known id must return a record with a folder.
    recordSpy = jest
      .spyOn(projectsState, "getCachedProjectRecordById")
      .mockImplementation((id: string) =>
        id === PROJECT_ID
          ? ({
              filePath: "Projects/proj-mru/project.md",
              project: { id: PROJECT_ID },
            } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
          : undefined
      );
  });

  afterEach(() => recordSpy.mockRestore());

  it("touches last-used after a successful enter that spawns a session", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    expect(ProjectFileManager.getInstance).toHaveBeenCalled();
    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("touches last-used on the restored-session path (no re-spawn)", async () => {
    const mgr = buildManager();
    // First enter spawns the scope's session; leaving and re-entering reuses it.
    await mgr.enterProject(PROJECT_ID);
    await mgr.exitProject();
    mockTouchProjectLastUsed.mockClear();
    sessionCreateSpy.mockClear();

    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("does not touch when returning to the global scope", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    mockTouchProjectLastUsed.mockClear();

    await mgr.exitProject();

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("does not touch a re-click of the already-active project", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    mockTouchProjectLastUsed.mockClear();

    // Same scope, live session — the early return must not count as a new use.
    await mgr.enterProject(PROJECT_ID);

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("does not touch when the spawn fails", async () => {
    const mgr = buildManager();
    // A rejected backend start makes getOrCreateActiveSession throw before the
    // touch runs — a failed enter must not bump MRU.
    mockBackendStart.mockRejectedValueOnce(new Error("spawn boom"));

    await expect(mgr.enterProject(PROJECT_ID)).rejects.toThrow();

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("touches only the current scope when another enter wins the spawn race", async () => {
    const OTHER_ID = "proj-other";
    recordSpy.mockImplementation((id: string) =>
      id === PROJECT_ID || id === OTHER_ID
        ? { filePath: `Projects/${id}/project.md`, project: { id } }
        : undefined
    );
    const mgr = buildManager();

    // Both enters set `activeProjectId` synchronously in call order, so the
    // second call wins the active scope before either spawn's post-await touch
    // runs (a later microtask). The first enter's touch must observe the moved
    // scope and skip, crediting only the winner.
    const enterStale = mgr.enterProject(PROJECT_ID);
    const enterWinner = mgr.enterProject(OTHER_ID);
    await Promise.all([enterStale, enterWinner]);

    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(OTHER_ID);
    expect(mockTouchProjectLastUsed).not.toHaveBeenCalledWith(PROJECT_ID);
  });

  it("rolls the active scope back when a cross-scope history load fails to resume", async () => {
    const mgr = buildManager();
    // The active session lives in the project scope.
    await mgr.enterProject(PROJECT_ID);
    const projectSession = mgr.getActiveSession();
    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

    // Opening a global native chat on an unresolvable backend switches the
    // active scope to global first, then rejects because the resume can't
    // start. The failure must restore the project scope — otherwise the active
    // scope and the (unchanged) active session would disagree.
    await expect(mgr.loadNativeSessionFromHistory("codex", "missing")).rejects.toThrow();

    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
    expect(mgr.getActiveSession()).toBe(projectSession);
  });

  it("rolls the entered scope back when its auto-spawn fails", async () => {
    const OTHER_ID = "proj-other-fail";
    recordSpy.mockImplementation((id: string) =>
      id === PROJECT_ID || id === OTHER_ID
        ? { filePath: `Projects/${id}/project.md`, project: { id } }
        : undefined
    );
    const mgr = buildManager();
    // Land in a project scope with a live session — the exact state a failed
    // entry into a DIFFERENT project must restore.
    await mgr.enterProject(PROJECT_ID);
    const projectSession = mgr.getActiveSession();
    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

    // Entering OTHER_ID switches the active scope and nulls the active session
    // before awaiting the fresh spawn; the spawn then rejects. (Inject at
    // AgentSession.start, which createSession always calls even on a warm proc —
    // the prior enter left the backend running, so a cold-start reject wouldn't
    // fire here.) The rollback must restore the prior scope + session rather than
    // strand the manager in a chatless OTHER_ID scope (callers only show a Notice).
    sessionCreateSpy.mockImplementationOnce(() => {
      throw new Error("spawn boom");
    });
    await expect(mgr.enterProject(OTHER_ID)).rejects.toThrow();

    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
    expect(mgr.getActiveSession()).toBe(projectSession);
  });
});

describe("AgentSessionManager fresh-visit tab detach", () => {
  const PROJECT_ID = "proj-detach";
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    sessionCreateSpy.mockClear();
    recordSpy = jest
      .spyOn(projectsState, "getCachedProjectRecordById")
      .mockImplementation((id: string) =>
        id === PROJECT_ID
          ? ({
              filePath: "Projects/proj-detach/project.md",
              project: { id: PROJECT_ID },
            } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
          : undefined
      );
  });

  afterEach(() => recordSpy.mockRestore());

  /** Enter the project, mark its active session conversational, then leave. */
  async function enterWithConversation(mgr: AgentSessionManager): Promise<AgentSession> {
    await mgr.enterProject(PROJECT_ID);
    const session = mgr.getActiveSession();
    if (!session) throw new Error("expected an active session after enter");
    getSessionTestHandle(session).setHasUserVisibleMessages(true);
    await mgr.exitProject();
    return session;
  }

  it("detaches a conversational session on re-entry and spawns a fresh one", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    // A fresh session was spawned and is the only tab shown for the scope.
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const visible = mgr.getSessionsForScope(PROJECT_ID);
    expect(visible).toHaveLength(1);
    expect(visible[0].internalId).not.toBe(old.internalId);
    // The old session is hidden from the strip but still alive in the pool.
    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getSessions()).toContain(old);
  });

  it("does not reuse an error-state landing; spawns a fresh session instead", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    // Its backend never opened — not a clean slate to adopt.
    getSessionTestHandle(landing).setStatus("error");
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(landing);
  });

  it("reuses an empty landing session instead of stacking a blank tab", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const landing = mgr.getActiveSession();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(landing);
    expect(mgr.getSessionsForScope(PROJECT_ID)).toHaveLength(1);
  });

  it("keeps a detached running session in getRunningChatIds (history spinner)", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    getSessionTestHandle(old).setStatus("running");

    await mgr.enterProject(PROJECT_ID);

    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getRunningChatIds().size).toBeGreaterThan(0);
  });

  it("keeps a detached needs-attention session in getAttentionChatIds (history dot)", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    old.markNeedsAttention();

    await mgr.enterProject(PROJECT_ID);

    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getAttentionChatIds().size).toBeGreaterThan(0);
  });

  it("re-attaches a detached session when it is surfaced via setActiveSession", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    await mgr.enterProject(PROJECT_ID);
    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);

    mgr.setActiveSession(old.internalId);

    expect(mgr.getSessionsForScope(PROJECT_ID)).toContain(old);
    expect(mgr.getActiveSession()).toBe(old);
  });

  it("closeSession picks a visible neighbor, never a detached session", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    await mgr.enterProject(PROJECT_ID);
    const fresh = mgr.getActiveSession();
    if (!fresh) throw new Error("expected a fresh active session");

    await mgr.closeSession(fresh.internalId);

    // The only other in-scope session is detached, so there is no visible
    // neighbor to fall back to — the active pointer must not resurrect `old`.
    expect(mgr.getActiveSession()).not.toBe(old);
  });
});

describe("AgentSessionManager context-source dirty tracking", () => {
  const PID = "proj-dirty";

  function makeRecord(
    contextSource: ProjectConfig["contextSource"],
    usageTimestamps = 0,
    systemPrompt = ""
  ): ProjectFileRecord {
    return {
      project: {
        id: PID,
        name: PID,
        systemPrompt,
        projectModelKey: "",
        modelConfigs: {},
        contextSource,
        created: 0,
        UsageTimestamps: usageTimestamps,
      },
      filePath: `Projects/${PID}/project.md`,
      folderName: PID,
    };
  }

  /** Publish a record set to the real store (drives subscribeToProjectRecords). */
  function publish(record: ProjectFileRecord): void {
    projectsState.updateCachedProjectRecords([record]);
  }

  // Dirty-clearing is chained off the (resolved) contextReady promise, so let
  // the microtask queue drain before asserting the dirty flag's effect.
  const flushAsync = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  // Track managers so each is shut down (unsubscribed) after its test —
  // otherwise a prior test's still-subscribed manager would react to the next
  // test's `publish()` and warm again, contaminating the call counts.
  const builtManagers: AgentSessionManager[] = [];
  function buildTrackedManager(): AgentSessionManager {
    const mgr = buildManager();
    builtManagers.push(mgr);
    return mgr;
  }

  beforeEach(() => {
    mockEnsureMaterialized.mockClear();
    sessionCreateSpy.mockClear();
    projectsState.updateCachedProjectRecords([]);
  });

  afterEach(async () => {
    await Promise.all(builtManagers.splice(0).map((mgr) => mgr.shutdown().catch(() => {})));
    projectsState.updateCachedProjectRecords([]);
  });

  it("marks an inactive project dirty so re-entry detaches the stale empty landing and respawns", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();

    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    await mgr.exitProject();

    // Source edit for the (now inactive) project: marks it dirty.
    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    // The stale empty landing is gone from the strip; a fresh session took over.
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const visible = mgr.getSessionsForScope(PID);
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toBe(landing);
    expect(mgr.getSessionsForScope(PID)).not.toContain(landing);
  });

  it("clears dirty once a fresh session captured the new sources (later re-entry reuses)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));
    await mgr.enterProject(PID); // dirty → fresh spawn
    await flushAsync(); // let the post-materialization dirty-clear run
    const fresh = mgr.getActiveSession();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID); // no longer dirty → reuse the empty landing

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(fresh);
  });

  it("keeps a project dirty when the fresh session fails to start (ready rejects)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" })); // dirty = v2

    // The dirty re-entry's fresh session fails to start: ready rejects, so the
    // ready-success dirty-clear never runs.
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const rejected = Promise.reject(new Error("startup boom"));
      rejected.catch(() => {}); // swallow the unhandled-rejection warning
      return makeMockSession({
        internalId: opts.internalId,
        backendId: opts.backendId,
        projectId: opts.projectId,
        ready: rejected,
      });
    });
    await mgr.enterProject(PID);
    await flushAsync();
    await mgr.exitProject();

    // dirty must SURVIVE (no session captured the new sources) → re-entry respawns.
    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a project dirty when the create captured an older signature (single-flight race)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.exitProject();

    // Source advances to v2 → dirty = signature(v2).
    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    // Simulate the next create JOINING an in-flight run that materialized the
    // OLDER v1 record: the result carries v1's signature, not the live v2.
    const v1Signature = getProjectContextSignature(makeRecord({ webUrls: "https://a.com" }));
    mockEnsureMaterialized.mockImplementationOnce(async () => ({
      additionalDirectories: [],
      contextSignature: v1Signature,
    }));

    await mgr.enterProject(PID); // dirty → fresh spawn capturing stale v1
    await flushAsync();
    await mgr.exitProject();

    // v1 ≠ dirty(v2), so the flag must SURVIVE — the stale landing is not reused.
    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores a usage-timestamp-only touch (no dirty, empty landing still reused)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    await mgr.exitProject();

    // Same context source, only the MRU timestamp moved — must NOT dirty.
    publish(makeRecord({ webUrls: "https://a.com" }, 12345));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(landing);
  });

  it("does not reuse an empty landing after a System-Prompt-only edit", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }, 0, "old instructions"));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    await mgr.exitProject();

    // The materialization signature is unchanged (sources identical), so the
    // project is NOT dirty — but the landing-capture signature changed, so the
    // stale landing (which baked in the old instructions) must not be reused.
    publish(makeRecord({ webUrls: "https://a.com" }, 0, "new instructions"));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(landing);
  });

  it("rematerializeContext forces a retry of known-bad sources", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    mockEnsureMaterialized.mockClear();

    const started = mgr.rematerializeContext(PID);
    await flushAsync();

    expect(started).toBe(true);
    expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
    // The 5th arg (forceRetryFailed) is forwarded as true so the materializer
    // re-fetches sources whose failure markers the automatic path would honor.
    expect(mockEnsureMaterialized.mock.calls[0][4]).toBe(true);
  });

  it("rematerializeContext early-exits while a run already owns the load atom", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    mockEnsureMaterialized.mockClear();

    // A full run is blocking the atom: the forced retry would otherwise join it
    // and have its force swallowed, so it must early-exit instead.
    const getMock = jest.requireMock("@/settings/model").settingsStore.get as jest.Mock;
    getMock.mockReturnValueOnce({ [PID]: { phase: "prefetch", blocking: true } });

    const started = mgr.rematerializeContext(PID);

    expect(started).toBe(false);
    expect(mockEnsureMaterialized).not.toHaveBeenCalled();
  });

  it("warms the active project's cache on a source edit without gating the composer", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID); // active = PID
    await flushAsync(); // let create-time materialization + atom writes settle

    // Clear create-time materialization + atom writes, isolate the warm.
    mockEnsureMaterialized.mockClear();
    const settingsStoreSet = jest.requireMock("@/settings/model").settingsStore.set as jest.Mock;
    settingsStoreSet.mockClear();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    // Background warm ran (disk refresh) but never published a blocking load
    // state — the composer of the session that won't consume it stays ungated.
    expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
    expect(settingsStoreSet).not.toHaveBeenCalled();
  });

  it("stops reacting to record changes after shutdown", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.shutdown();

    mockEnsureMaterialized.mockClear();
    // A post-shutdown edit must not warm or throw.
    expect(() => publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }))).not.toThrow();
    expect(mockEnsureMaterialized).not.toHaveBeenCalled();
  });

  it("publishes processingSources + incremental failedSources during a run, clears at done", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    const setMock = jest.requireMock("@/settings/model").settingsStore.set as jest.Mock;
    // Reconstruct the latest published load-state by replaying the most recent
    // `settingsStore.set(agentProjectContextLoadAtom, updater)` call (the store is
    // mocked, so there is no live atom to read back).
    const latest = (): AgentProjectContextLoadState | undefined => {
      for (let i = setMock.mock.calls.length - 1; i >= 0; i--) {
        const [atom, updater] = setMock.mock.calls[i];
        if (atom !== agentProjectContextLoadAtom || typeof updater !== "function") continue;
        const next = updater({}) as Record<string, AgentProjectContextLoadState>;
        if (next[PID]) return next[PID];
      }
      return undefined;
    };

    let drive!: (p: ContextMaterializeProgress) => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockEnsureMaterialized.mockImplementationOnce(
      async (
        _app: unknown,
        _pid: string,
        _cwd: string,
        onProgress: (p: ContextMaterializeProgress) => void
      ) => {
        drive = onProgress;
        onProgress({ phase: "prefetch", done: 0, total: 1 });
        onProgress({ phase: "itemStart", item: { kind: "web", source: "https://a.com" } });
        await gate;
        return { additionalDirectories: [] };
      }
    );

    const entering = mgr.enterProject(PID);
    await flushAsync();

    // Mid-flight: the source being fetched is published in `processingSources`.
    expect(latest()).toMatchObject({
      phase: "prefetch",
      blocking: true,
      processingSources: [{ kind: "web", source: "https://a.com" }],
    });

    // Settle as a failure: it leaves `processingSources` and lands in
    // `failedSources` immediately — not deferred to the end of the run.
    drive({
      phase: "itemFailed",
      item: { kind: "web", source: "https://a.com" },
      failure: { kind: "web", source: "https://a.com", error: "boom", usedStaleSnapshot: false },
    });
    const afterFail = latest()!;
    expect(afterFail.processingSources).toBeUndefined();
    expect(afterFail.failedSources).toEqual([
      { path: "https://a.com", type: "web", error: "boom", usedStaleSnapshot: false },
    ]);

    release();
    await entering;
    await flushAsync(); // let the materialize `.then()` publish the terminal "done"
    // Done: nothing is processing.
    expect(latest()).toMatchObject({ phase: "done", blocking: false });
    expect(latest()!.processingSources).toBeUndefined();
  });
});
