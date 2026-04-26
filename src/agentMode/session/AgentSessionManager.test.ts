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
const sessionCreateSpy = jest.spyOn(AgentSession, "create").mockImplementation(
  async (_backend, _cwd, internalId) =>
    ({
      internalId,
      acpSessionId: `acp-${nextAcpSessionId++}`,
      getStatus: () => "idle",
      cancel: mockSessionCancel,
      dispose: mockSessionDispose,
      setModel: jest.fn(),
      getLabel: () => null,
      setLabel: jest.fn(),
      subscribe: () => () => {},
    }) as unknown as AgentSession
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
  return new AgentSessionManager(
    buildApp(),
    buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
    {
      descriptor: buildDescriptor(),
      permissionPrompter: jest.fn(),
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

  it("a concurrent create that succeeds does not wipe a sibling create's lastError", async () => {
    const mgr = buildManager();
    // First call fails. Second call starts before first settles, so the
    // pre-fix code would have cleared `lastError` at the second call's start
    // and the failure surfaced by the first would be lost.
    sessionCreateSpy
      .mockImplementationOnce(async () => {
        // Yield so the second create can begin and (used to) clear lastError
        // before this one rejects.
        await Promise.resolve();
        await Promise.resolve();
        throw new Error("boom");
      })
      .mockImplementationOnce(
        async (_b, _c, internalId) =>
          ({
            internalId,
            acpSessionId: "acp-ok",
            getStatus: () => "idle",
            cancel: mockSessionCancel,
            dispose: mockSessionDispose,
            setModel: jest.fn(),
            getLabel: () => null,
            setLabel: jest.fn(),
            subscribe: () => () => {},
          }) as unknown as AgentSession
      );

    const failing = mgr.createSession().catch(() => undefined);
    const succeeding = mgr.createSession();
    await Promise.all([failing, succeeding]);

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
