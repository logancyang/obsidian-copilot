/**
 * Tests the warm-reuse contract added so the first chat-open per backend
 * doesn't pay a second subprocess spawn + initialize handshake. The probe
 * subprocess survives `runProbe` and is handed to the manager via
 * `takeWarm`; failures and shutdowns must dispose the still-warm proc.
 */
import { App, FileSystemAdapter } from "obsidian";
import { waitFor } from "@testing-library/react";
import type CopilotPlugin from "@/main";
import { AgentModelPreloader } from "./AgentModelPreloader";
import type { BackendDescriptor, BackendProcess, BackendState, ModelSelection } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ agentMode: {} })),
}));

function buildApp(): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)("/vault");
  return { vault: { adapter } } as unknown as App;
}

function buildPlugin(): CopilotPlugin {
  return { manifest: { version: "1.0.0" } } as unknown as CopilotPlugin;
}

interface MockProcHandle {
  proc: BackendProcess;
  start: jest.Mock;
  shutdown: jest.Mock;
  newSession: jest.Mock;
  exitListeners: Set<() => void>;
  emitExit: () => void;
}

function makeMockProc(opts?: { newSessionState?: BackendState }): MockProcHandle {
  const start = jest.fn(async () => undefined);
  const shutdown = jest.fn(async () => undefined);
  const state: BackendState = opts?.newSessionState ?? {
    model: {
      current: { baseModelId: "claude-sonnet", effort: null } satisfies ModelSelection,
      availableModels: [
        {
          baseModelId: "claude-sonnet",
          name: "Claude Sonnet",
          provider: "anthropic",
          effortOptions: [],
        },
      ],
      apply: { kind: "setModel" },
    },
    mode: null,
  };
  const newSession = jest.fn(async () => ({ sessionId: "probe-1", state }));
  const exitListeners = new Set<() => void>();
  const proc: BackendProcess = {
    start,
    isRunning: () => true,
    onExit: (fn) => {
      exitListeners.add(fn);
      return () => exitListeners.delete(fn);
    },
    setPermissionPrompter: jest.fn(),
    registerSessionHandler: jest.fn(() => () => {}),
    newSession,
    prompt: jest.fn(),
    cancel: jest.fn(),
    setSessionModel: jest.fn(),
    isSetSessionModelSupported: () => true,
    setSessionMode: jest.fn(),
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: jest.fn(),
    isSetSessionConfigOptionSupported: () => true,
    listSessions: jest.fn(),
    resumeSession: jest.fn(),
    loadSession: jest.fn(),
    shutdown,
  };
  return {
    proc,
    start,
    shutdown,
    newSession,
    exitListeners,
    emitExit: () => {
      for (const fn of exitListeners) fn();
    },
  };
}

function buildDescriptor(makeProc: () => MockProcHandle): {
  descriptor: BackendDescriptor;
  procHandle: MockProcHandle;
} {
  const procHandle = makeProc();
  const descriptor = {
    id: "claude-sdk",
    displayName: "Claude",
    getInstallState: () => ({ kind: "ready", source: "managed" }) as const,
    subscribeInstallState: jest.fn(() => () => {}),
    openInstallUI: jest.fn(),
    createBackendProcess: jest.fn(() => procHandle.proc),
  } as unknown as BackendDescriptor;
  return { descriptor, procHandle };
}

describe("AgentModelPreloader", () => {
  describe("getCachedModelCatalog()", () => {
    it("exposes only the discovered model catalog from a full probe state", async () => {
      const probeState: BackendState = {
        model: {
          current: { baseModelId: "big-pickle", effort: null },
          availableModels: [
            {
              baseModelId: "big-pickle",
              name: "Big Pickle",
              provider: null,
              effortOptions: [],
            },
          ],
          apply: { kind: "setModel" },
        },
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      };
      const { descriptor } = buildDescriptor(() => makeMockProc({ newSessionState: probeState }));
      const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

      await preloader.preload("claude-sdk");

      expect(preloader.getCachedModelCatalog("claude-sdk")).toEqual({
        availableModels: probeState.model?.availableModels,
      });
    });

    it("records a completed probe that reports no model catalog", async () => {
      const modeOnlyState: BackendState = {
        model: null,
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      };
      const { descriptor } = buildDescriptor(() =>
        makeMockProc({ newSessionState: modeOnlyState })
      );
      const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

      await preloader.preload("claude-sdk");

      expect(preloader.getCachedModelCatalog("claude-sdk")).toEqual({ availableModels: null });
    });
  });

  it("retains the probe subprocess after a successful preload and hands it to the manager", async () => {
    const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");

    // Probe started but was NOT shut down — that's the whole point.
    expect(procHandle.start).toHaveBeenCalledTimes(1);
    expect(procHandle.shutdown).not.toHaveBeenCalled();

    expect(preloader.getCachedModelCatalog("claude-sdk")?.availableModels?.[0].baseModelId).toBe(
      "claude-sonnet"
    );

    // First takeWarm yields only the running process.
    const warm = preloader.takeWarm("claude-sdk");
    expect(warm).not.toBeNull();
    expect(warm?.proc).toBe(procHandle.proc);
    expect(warm).not.toHaveProperty("state");

    // Single-shot — second call returns null so the manager can never
    // hand out the same warm proc to two sessions.
    expect(preloader.takeWarm("claude-sdk")).toBeNull();

    // Probe-owned discovery survives process handoff.
    expect(preloader.getCachedModelCatalog("claude-sdk")?.availableModels?.[0].baseModelId).toBe(
      "claude-sonnet"
    );
  });

  it("shuts down a still-warm proc on dispose so the subprocess does not leak", async () => {
    const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");
    expect(procHandle.shutdown).not.toHaveBeenCalled();

    preloader.shutdown();
    await waitFor(() => expect(procHandle.shutdown).toHaveBeenCalledTimes(1));
    expect(preloader.takeWarm("claude-sdk")).toBeNull();
    expect(preloader.getCachedModelCatalog("claude-sdk")).toBeNull();
  });

  it("drops the warm entry when the probe subprocess exits before adoption", async () => {
    const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
    descriptor.prefetchEffortCatalog = jest.fn(async () => ({
      "claude-sonnet": [{ label: "High", value: "high" }],
    }));
    descriptor.getEnabledModelEntries = jest.fn(() => [
      {
        baseModelId: "claude-sonnet",
        name: "Claude Sonnet",
        provider: "anthropic",
        credentialState: "ok",
      },
    ]);
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");
    expect(preloader.takeWarm("claude-sdk")).not.toBeNull();
    // Re-prime — populate a second warm entry to exercise the onExit path.
    await preloader.preload("claude-sdk");
    expect(preloader.getEffortCatalog("claude-sdk")).not.toBeNull();
    procHandle.emitExit();

    expect(preloader.takeWarm("claude-sdk")).toBeNull();
    expect(preloader.getCachedModelCatalog("claude-sdk")).toBeNull();
    expect(preloader.getEffortCatalog("claude-sdk")).toBeNull();
  });

  it("shuts down the probe proc when the agent reports no usable state", async () => {
    const { descriptor, procHandle } = buildDescriptor(() =>
      makeMockProc({ newSessionState: { model: null, mode: null } })
    );
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");

    // No usable catalog → preloader discards the proc so we don't keep a
    // useless subprocess around.
    expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
    expect(preloader.takeWarm("claude-sdk")).toBeNull();
  });

  it("shuts down the probe proc when newSession throws", async () => {
    const { descriptor, procHandle } = buildDescriptor(() => {
      const handle = makeMockProc();
      handle.newSession.mockRejectedValueOnce(new Error("agent unreachable"));
      return handle;
    });
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");

    expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
    expect(preloader.takeWarm("claude-sdk")).toBeNull();
  });

  it("refresh re-probes a warm backend against current settings", async () => {
    const { descriptor } = buildDescriptor(() => makeMockProc());
    const create = descriptor.createBackendProcess as jest.Mock;
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");
    expect(create).toHaveBeenCalledTimes(1);

    // A config change after the warm probe settled: refresh drops the warm
    // entry and runs a fresh probe.
    await preloader.refresh("claude-sdk");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("refresh returns null when nothing is warm or in flight", async () => {
    const { descriptor } = buildDescriptor(() => makeMockProc());
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    // Never preloaded → a config change must not spin a probe up from nothing.
    expect(preloader.refresh("claude-sdk")).toBeNull();
  });

  it("coalesces a burst of refreshes into a single trailing re-probe", async () => {
    // Models a BYOK save: several config writes call refresh in one synchronous
    // burst. The 2nd/3rd land while the 1st's probe is still in flight (runProbe
    // awaits proc.start before reading the catalog), so they fold into exactly
    // one trailing re-probe against the settled settings — not one per write.
    const { descriptor } = buildDescriptor(() => makeMockProc());
    const create = descriptor.createBackendProcess as jest.Mock;
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk"); // probe #1 → something warm
    expect(create).toHaveBeenCalledTimes(1);

    const chain = preloader.refresh("claude-sdk"); // drops warm, starts probe #2
    expect(chain).not.toBeNull();
    void preloader.refresh("claude-sdk"); // in-flight → trailing-rerun flag
    void preloader.refresh("claude-sdk"); // in-flight → already flagged
    await chain;

    // probe #2 (in-flight) + exactly one trailing probe #3 = 3 total.
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("clearCached shuts down and drops a still-warm proc", async () => {
    const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
    const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);

    await preloader.preload("claude-sdk");
    expect(preloader.getCachedModelCatalog("claude-sdk")).not.toBeNull();

    preloader.clearCached("claude-sdk");

    await waitFor(() => expect(procHandle.shutdown).toHaveBeenCalledTimes(1));
    expect(preloader.getCachedModelCatalog("claude-sdk")).toBeNull();
    expect(preloader.takeWarm("claude-sdk")).toBeNull();
  });
});
