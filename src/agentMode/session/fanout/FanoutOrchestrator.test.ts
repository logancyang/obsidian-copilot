import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  ModelApplySpec,
  ModelSelection,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { createFanoutTurn, FanoutOrchestrator, type FanoutHost } from "./FanoutOrchestrator";
import {
  FANOUT_AGENT_TIMEOUT_ERROR,
  FANOUT_AGENT_TIMEOUT_MS,
  FANOUT_ALL_FAILED_SUMMARY,
  FANOUT_CANCEL_GRACE_MS,
  FANOUT_TRAILING_CHUNK_GRACE_MS,
} from "./fanoutTypes";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

interface MockProc {
  proc: BackendProcess;
  emit: (event: SessionEvent) => void;
  setSessionMode: jest.Mock;
  setSessionModel: jest.Mock;
  setSessionConfigOption: jest.Mock;
  cancel: jest.Mock;
  resolvePrompt: () => void;
  rejectPrompt: (err: unknown) => void;
  promptCount: () => number;
  /** Resolve a controlled (initially pending) `newSession` — no-op otherwise. */
  resolveNewSession: () => void;
  newSessionCount: () => number;
}

/**
 * Mock backend process whose `prompt` stays pending until the test resolves it,
 * so streamed events can land before the turn settles. `sessionId` is fixed per
 * backend so the orchestrator's per-session handler routing is exercised. Each
 * `prompt` call pushes its own resolver, so the answer turn and the later
 * summary turn (a second sub-session on the main backend) resolve independently;
 * `resolvePrompt`/`rejectPrompt` settle the oldest still-pending prompt.
 */
/**
 * When `modelApply` is supplied the opened sub-session's `state.model.apply`
 * carries that spec, so the orchestrator routes the model switch through the
 * declared channel (a `setConfigOption` spec stands in for opencode ≥ 1.15.13,
 * where `session/set_model` is gone). The refreshed state returned by each
 * config-option round-trip echoes the same spec so the model-specific effort
 * `effortConfigId` is readable after the bare model is activated.
 */
/**
 * `controlledNewSession` makes `newSession` stay pending until the test calls
 * `resolveNewSession()`, modeling a cold or wedged backend whose `session/new`
 * has not returned yet (so the orchestrator is blocked in SETUP, not the
 * prompt). Left off, `newSession` resolves immediately as before.
 */
function makeMockProc(
  sessionId: string,
  modelApply?: ModelApplySpec,
  controlledNewSession?: boolean
): MockProc {
  let handler: SessionUpdateHandler | null = null;
  const stateForModelApply = (): BackendState => ({
    model: modelApply ? ({ apply: modelApply } as BackendState["model"]) : null,
    mode: null,
  });
  const pendingNewSession: Array<() => void> = [];
  const pending: Array<{
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];
  const promptPromise = () =>
    new Promise<{ stopReason: "end_turn" }>((resolve, reject) => {
      pending.push({ resolve: () => resolve({ stopReason: "end_turn" }), reject });
    });
  const settleOldest = (
    apply: (p: { resolve: () => void; reject: (e: unknown) => void }) => void
  ) => {
    const next = pending.shift();
    if (next) apply(next);
  };
  const setSessionMode = jest.fn(async () => ({ model: null, mode: null }));
  const setSessionModel = jest.fn(async () => ({ model: null, mode: null }));
  const setSessionConfigOption = jest.fn(async () => stateForModelApply());
  const cancel = jest.fn(async () => undefined);
  const proc = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: (_id: string, h: SessionUpdateHandler) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    newSession: jest.fn(() => {
      const opened = { sessionId, state: stateForModelApply() };
      if (!controlledNewSession) return Promise.resolve(opened);
      return new Promise((resolve) => pendingNewSession.push(() => resolve(opened)));
    }),
    prompt: jest.fn(() => promptPromise()),
    cancel,
    setSessionModel,
    isSetSessionModelSupported: () => true,
    setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: jest.fn(async () => ({ sessions: [] })),
    resumeSession: jest.fn(),
    loadSession: jest.fn(),
    supportsMcpTransport: () => false,
    shutdown: async () => {},
  } as unknown as BackendProcess;
  return {
    proc,
    emit: (event) => handler?.(event),
    setSessionMode,
    setSessionModel,
    setSessionConfigOption,
    cancel,
    resolvePrompt: () => settleOldest((p) => p.resolve()),
    rejectPrompt: (err) => settleOldest((p) => p.reject(err)),
    promptCount: () => (proc.prompt as jest.Mock).mock.calls.length,
    resolveNewSession: () => pendingNewSession.shift()?.(),
    newSessionCount: () => (proc.newSession as jest.Mock).mock.calls.length,
  };
}

/**
 * Build a descriptor stub. `effortConfig` makes the wire codec
 * descriptor-style (Claude SDK shape): `encode` emits the bare base id and
 * effort travels through a config option, so the orchestrator must dispatch it
 * via `setSessionConfigOption`. Omitting it gives the suffix-style codec
 * (codex/opencode) that packs effort into the model id.
 */
function descriptorFor(
  id: BackendId,
  readOnlyModeId?: string,
  effortConfig?: { id: string }
): BackendDescriptor {
  return {
    id,
    wire: effortConfig
      ? {
          encode: (s: ModelSelection) => s.baseModelId,
          effortConfigFor: () => ({ id: effortConfig.id }),
        }
      : { encode: (s: ModelSelection) => `${s.baseModelId}/${s.effort ?? "default"}` },
    getModeMapping: readOnlyModeId
      ? () => ({
          kind: "setMode" as const,
          // `plan` deliberately diverges from `readOnlyModeId` so the test
          // proves the orchestrator applies the read-only sandbox id, NOT plan.
          canonical: { plan: "plan", default: "auto" },
          readOnlyModeId,
        })
      : undefined,
  } as unknown as BackendDescriptor;
}

function textChunk(sessionId: string, text: string): SessionEvent {
  return {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  };
}

interface HostHarness {
  host: FanoutHost;
  procs: Map<BackendId, MockProc>;
  readOnlyRegistered: string[];
  readOnlyUnregistered: string[];
}

function makeHost(
  config: Record<
    BackendId,
    {
      sessionId: string;
      readOnlyModeId?: string;
      effortConfig?: { id: string };
      modelApply?: ModelApplySpec;
      controlledNewSession?: boolean;
    }
  >,
  defaults: Partial<Record<BackendId, ModelSelection>> = {}
): HostHarness {
  const procs = new Map<BackendId, MockProc>();
  const descriptors = new Map<BackendId, BackendDescriptor>();
  for (const [
    id,
    { sessionId, readOnlyModeId, effortConfig, modelApply, controlledNewSession },
  ] of Object.entries(config)) {
    procs.set(id, makeMockProc(sessionId, modelApply, controlledNewSession));
    descriptors.set(id, descriptorFor(id, readOnlyModeId, effortConfig));
  }
  const readOnlyRegistered: string[] = [];
  const readOnlyUnregistered: string[] = [];
  const host: FanoutHost = {
    ensureBackendForFanout: async (backendId) => ({
      proc: procs.get(backendId)!.proc,
      descriptor: descriptors.get(backendId)!,
    }),
    getDefaultSelection: (backendId) => defaults[backendId] ?? null,
    getDisplayName: (backendId) => backendId.toUpperCase(),
    getCwd: () => "/vault",
    getMcpServers: () => [],
    registerReadOnlySession: (sessionId) => {
      readOnlyRegistered.push(sessionId);
      return () => readOnlyUnregistered.push(sessionId);
    },
  };
  return { host, procs, readOnlyRegistered, readOnlyUnregistered };
}

const flush = () => new Promise((r) => window.setTimeout(r, 0));

/**
 * Real-timer flush that also clears the post-resolve trailing-chunk grace a
 * normally-completed sub-session now waits before it unregisters its handler.
 * Use after resolving an answer prompt when the test then asserts on the
 * downstream summary dispatch / slot text (which only lands once that grace
 * elapses). Padded past the grace so the deferred teardown has fired.
 */
const flushPastGrace = () =>
  new Promise((r) => window.setTimeout(r, FANOUT_TRAILING_CHUNK_GRACE_MS + 20));

/**
 * Drain a long chain of dependent microtasks under fake timers. A single
 * `advanceTimersByTimeAsync(0)` flushes only one microtask wave; the
 * timeout-reject → runAgent catch → Promise.all → runSummary dispatch path
 * spans several, so we pump a handful of waves.
 */
const drainMicrotasks = async () => {
  for (let i = 0; i < 8; i++) await jest.advanceTimersByTimeAsync(0);
};

/**
 * Build a `run` input with sensible defaults: `mainAgent` (the summarizer)
 * defaults to the first agent for the common case where the main agent is also
 * an answerer, but it is decoupled from `agents` — tests override it to a
 * backend that is NOT an answerer. `originalPromptText` is a fixed question.
 */
function runInput(
  agents: BackendId[],
  overrides: Partial<Parameters<FanoutOrchestrator["run"]>[0]> = {}
): Parameters<FanoutOrchestrator["run"]>[0] {
  return {
    agents,
    mainAgent: agents[0],
    prompt: [{ type: "text", text: "q" }],
    originalPromptText: "the original question",
    signal: new AbortController().signal,
    onChange: () => {},
    ...overrides,
  };
}

describe("createFanoutTurn", () => {
  it("seeds one running slot per agent (insertion order) plus a pending summary", () => {
    const turn = createFanoutTurn(["opencode", "claude", "codex"]);
    expect(Object.keys(turn.answers)).toEqual(["opencode", "claude", "codex"]);
    expect(turn.answers.claude).toEqual({ backendId: "claude", status: "running", text: "" });
    expect(turn.summary).toEqual({ status: "pending", text: "" });
  });
});

describe("FanoutOrchestrator.run", () => {
  it("streams each agent's answer into its own slot and marks them done", async () => {
    const { host, procs, readOnlyRegistered, readOnlyUnregistered } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const snapshots: string[] = [];

    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], {
        prompt: [{ type: "text", text: "review this" }],
        signal: controller.signal,
        onChange: (turn) => snapshots.push(JSON.stringify(turn.answers)),
      })
    );

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "Claude says hi"));
    procs.get("codex")!.emit(textChunk("s-codex", "Codex says hi"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.resolvePrompt();
    // Answers settled; the main agent (claude) now opens a summary sub-session
    // once the post-resolve trailing-chunk grace on both answers elapses.
    await flushPastGrace();
    procs.get("claude")!.emit(textChunk("s-claude", "summary"));
    procs.get("claude")!.resolvePrompt();

    const turn = await runPromise;
    expect(turn.answers.claude).toEqual({
      backendId: "claude",
      status: "done",
      text: "Claude says hi",
    });
    expect(turn.answers.codex).toEqual({
      backendId: "codex",
      status: "done",
      text: "Codex says hi",
    });
    expect(turn.summary.status).toBe("done");
    expect(turn.summary.text).toBe("summary");
    // Three sub-sessions registered read-only: two answers + the summary (a
    // second session on the main backend), all unregistered on teardown.
    expect(readOnlyRegistered.sort()).toEqual(["s-claude", "s-claude", "s-codex"]);
    expect(readOnlyUnregistered.sort()).toEqual(["s-claude", "s-claude", "s-codex"]);
    expect(snapshots.length).toBeGreaterThan(1);
  });

  it("summarizes on the main agent even when it is NOT one of the answerers", async () => {
    // The session main agent (claude) is the summarizer but did NOT answer:
    // only opencode is an answerer (`@opencode what model are you`). claude must
    // still open a summary sub-session over opencode's answer.
    const { host, procs } = makeHost({
      opencode: { sessionId: "s-opencode" },
      claude: { sessionId: "s-claude" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["opencode"], { mainAgent: "claude", signal: controller.signal })
    );

    await flush();
    procs.get("opencode")!.emit(textChunk("s-opencode", "opencode answer"));
    procs.get("opencode")!.resolvePrompt();
    // Only opencode got an answer slot — claude has none unless mentioned.
    await flushPastGrace();
    procs.get("claude")!.emit(textChunk("s-claude", "summary over opencode"));
    procs.get("claude")!.resolvePrompt();
    const turn = await runPromise;

    expect(Object.keys(turn.answers)).toEqual(["opencode"]);
    expect(turn.answers.opencode.status).toBe("done");
    // The summary ran on the main backend (claude), its first and only prompt.
    expect(procs.get("claude")!.promptCount()).toBe(1);
    expect(procs.get("opencode")!.promptCount()).toBe(1);
    expect(turn.summary.status).toBe("done");
    expect(turn.summary.text).toBe("summary over opencode");
    // The summary prompt named opencode's answer (read off the main backend).
    const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[0][0];
    expect(summaryCall.prompt[0].text).toContain("OPENCODE");
    expect(summaryCall.prompt[0].text).toContain("opencode answer");
  });

  it("runs the summary for a single (non-main) answerer", async () => {
    // A lone non-main answerer still gets a summary (always-summarize): the main
    // agent reconciles even a single answer rather than skipping the summary.
    const { host, procs } = makeHost({
      opencode: { sessionId: "s-opencode" },
      claude: { sessionId: "s-claude" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["opencode"], { mainAgent: "claude", signal: controller.signal })
    );

    await flush();
    procs.get("opencode")!.emit(textChunk("s-opencode", "the answer"));
    procs.get("opencode")!.resolvePrompt();
    await flushPastGrace();
    procs.get("claude")!.emit(textChunk("s-claude", "recap"));
    procs.get("claude")!.resolvePrompt();
    const turn = await runPromise;

    expect(turn.summary.status).toBe("done");
    expect(turn.summary.text).toBe("recap");
  });

  it("isolates a failed agent as an error slot while others complete", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();

    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], { signal: controller.signal })
    );

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "ok"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.rejectPrompt(new Error("backend boom"));
    // The main agent (claude) summarizes over the one survivor once claude's
    // post-resolve trailing-chunk grace elapses.
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();

    const turn = await runPromise;
    expect(turn.answers.claude.status).toBe("done");
    expect(turn.answers.codex.status).toBe("error");
    expect(turn.answers.codex.error).toContain("backend boom");
  });

  it("applies the read-only sandbox id (never plan) only for backends that advertise one", async () => {
    const { host, procs } = makeHost({
      // codex advertises a genuine read-only sandbox; its plan id is "plan".
      codex: { sessionId: "s-codex", readOnlyModeId: "read-only" },
      // opencode has no readOnlyModeId → no mode switch (relies on prompt +
      // permission layers). Stands in for any backend lacking a sandbox.
      opencode: { sessionId: "s-opencode" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();

    const runPromise = orchestrator.run(
      runInput(["codex", "opencode"], { signal: controller.signal })
    );
    await flush();
    procs.get("codex")!.resolvePrompt();
    procs.get("opencode")!.resolvePrompt();
    // Main agent (codex) summary turn.
    await flushPastGrace();
    procs.get("codex")!.resolvePrompt();
    await runPromise;

    // Applies the read-only sandbox id, NOT canonical.plan ("plan") — a backend
    // (Claude) whose plan mode writes plan files must never be put into it here.
    expect(procs.get("codex")!.setSessionMode).toHaveBeenCalledWith({
      sessionId: "s-codex",
      modeId: "read-only",
    });
    expect(procs.get("codex")!.setSessionMode).not.toHaveBeenCalledWith({
      sessionId: "s-codex",
      modeId: "plan",
    });
    // No readOnlyModeId → setSessionMode is never called for that backend.
    expect(procs.get("opencode")!.setSessionMode).not.toHaveBeenCalled();
  });

  it("switches a wire-encoded-effort backend with setSessionModel only (no config option)", async () => {
    const { host, procs } = makeHost(
      { codex: { sessionId: "s-codex" } },
      { codex: { baseModelId: "gpt-5-codex", effort: "high" } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["codex"], { signal: controller.signal }));
    await flush();
    procs.get("codex")!.resolvePrompt();
    // Summary turn on the same (main) backend.
    await flushPastGrace();
    procs.get("codex")!.resolvePrompt();
    await runPromise;

    // Effort rides inside the wire id, so the model call carries everything…
    expect(procs.get("codex")!.setSessionModel).toHaveBeenCalledWith({
      sessionId: "s-codex",
      modelId: "gpt-5-codex/high",
    });
    // …and no spurious effort config-option round-trip fires.
    expect(procs.get("codex")!.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it("applies model AND effort for a config-option-effort backend", async () => {
    const { host, procs } = makeHost(
      { claude: { sessionId: "s-claude", effortConfig: { id: "effort" } } },
      { claude: { baseModelId: "claude-opus-4-5", effort: "high" } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    procs.get("claude")!.resolvePrompt();
    // Summary turn on the same (main) backend.
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    // Claude's wire id is the bare base; effort travels via setSessionConfigOption.
    expect(procs.get("claude")!.setSessionModel).toHaveBeenCalledWith({
      sessionId: "s-claude",
      modelId: "claude-opus-4-5",
    });
    expect(procs.get("claude")!.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s-claude",
      configId: "effort",
      value: "high",
    });
  });

  it("routes the model via setSessionConfigOption (not setSessionModel) for a config-option-model backend", async () => {
    // opencode ≥ 1.15.13: the catalog is a `category:"model"` config option and
    // `session/set_model` is gone, so the MODEL itself must be applied via
    // setSessionConfigOption and effort via the model-specific effort option.
    const { host, procs } = makeHost(
      {
        opencode: {
          sessionId: "s-opencode",
          modelApply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought" },
        },
      },
      { opencode: { baseModelId: "anthropic/claude-opus-4-5", effort: "high" } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["opencode"], { signal: controller.signal }));
    await flush();
    procs.get("opencode")!.resolvePrompt();
    await flushPastGrace();
    procs.get("opencode")!.resolvePrompt();
    await runPromise;

    // The model goes through the config-option channel with the bare wire id…
    expect(procs.get("opencode")!.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s-opencode",
      configId: "model",
      value: "anthropic/claude-opus-4-5/default",
    });
    // …effort through the model-specific effort option reported by the state…
    expect(procs.get("opencode")!.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s-opencode",
      configId: "thought",
      value: "high",
    });
    // …and setSessionModel (the now-unsupported RPC) is never touched.
    expect(procs.get("opencode")!.setSessionModel).not.toHaveBeenCalled();
  });

  it("applies only the model (no effort option) for a config-option-model backend with default effort", async () => {
    const { host, procs } = makeHost(
      {
        opencode: {
          sessionId: "s-opencode",
          modelApply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought" },
        },
      },
      { opencode: { baseModelId: "anthropic/claude-opus-4-5", effort: null } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["opencode"], { signal: controller.signal }));
    await flush();
    procs.get("opencode")!.resolvePrompt();
    await flushPastGrace();
    procs.get("opencode")!.resolvePrompt();
    await runPromise;

    // The model switch fires once (the bare model); no effort round-trip.
    expect(procs.get("opencode")!.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s-opencode",
      configId: "model",
      value: "anthropic/claude-opus-4-5/default",
    });
    expect(procs.get("opencode")!.setSessionConfigOption).not.toHaveBeenCalledWith({
      sessionId: "s-opencode",
      configId: "thought",
      value: expect.anything(),
    });
    expect(procs.get("opencode")!.setSessionModel).not.toHaveBeenCalled();
  });

  it("no-ops the config-option-model channel when no default selection is configured", async () => {
    const { host, procs } = makeHost({
      opencode: {
        sessionId: "s-opencode",
        modelApply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought" },
      },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["opencode"], { signal: controller.signal }));
    await flush();
    procs.get("opencode")!.resolvePrompt();
    await flushPastGrace();
    procs.get("opencode")!.resolvePrompt();
    await runPromise;

    expect(procs.get("opencode")!.setSessionConfigOption).not.toHaveBeenCalled();
    expect(procs.get("opencode")!.setSessionModel).not.toHaveBeenCalled();
  });

  it("swallows a failed config-option-model apply and still runs the turn", async () => {
    const { host, procs } = makeHost(
      {
        opencode: {
          sessionId: "s-opencode",
          modelApply: { kind: "setConfigOption", configId: "model", effortConfigId: "thought" },
        },
      },
      { opencode: { baseModelId: "anthropic/claude-opus-4-5", effort: "high" } }
    );
    procs
      .get("opencode")!
      .setSessionConfigOption.mockRejectedValueOnce(new Error("set_config_option failed"));
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["opencode"], { signal: controller.signal }));
    await flush();
    procs.get("opencode")!.emit(textChunk("s-opencode", "still answered"));
    procs.get("opencode")!.resolvePrompt();
    await flushPastGrace();
    procs.get("opencode")!.resolvePrompt();
    const turn = await runPromise;

    expect(turn.answers.opencode.status).toBe("done");
    expect(turn.answers.opencode.text).toBe("still answered");
  });

  it("applies the model but skips the config option for an explicit-default effort", async () => {
    // The user pinned the model but left effort at the backend default
    // (`effort: null`), so the model still switches while the effort
    // config-option round-trip must NOT fire.
    const { host, procs } = makeHost(
      { claude: { sessionId: "s-claude", effortConfig: { id: "effort" } } },
      { claude: { baseModelId: "claude-opus-4-5", effort: null } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    procs.get("claude")!.resolvePrompt();
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    expect(procs.get("claude")!.setSessionModel).toHaveBeenCalledWith({
      sessionId: "s-claude",
      modelId: "claude-opus-4-5",
    });
    expect(procs.get("claude")!.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it("no-ops when the backend has no configured default selection", async () => {
    const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    procs.get("claude")!.resolvePrompt();
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    expect(procs.get("claude")!.setSessionModel).not.toHaveBeenCalled();
    expect(procs.get("claude")!.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it("swallows a failed default-model apply and still runs the turn", async () => {
    const { host, procs } = makeHost(
      { claude: { sessionId: "s-claude", effortConfig: { id: "effort" } } },
      { claude: { baseModelId: "claude-opus-4-5", effort: "high" } }
    );
    // The model switch fails (e.g. backend dropped set_model); the turn must
    // still proceed on the backend default rather than throwing.
    procs.get("claude")!.setSessionModel.mockRejectedValueOnce(new Error("set_model gone"));
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "still answered"));
    procs.get("claude")!.resolvePrompt();
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    const turn = await runPromise;

    // The rejected model apply is swallowed: the answer still streams and the
    // slot lands done instead of erroring out the whole turn.
    expect(turn.answers.claude.status).toBe("done");
    expect(turn.answers.claude.text).toBe("still answered");
  });

  it("cancels in-flight sub-session prompts when the signal aborts", async () => {
    const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    controller.abort();
    procs.get("claude")!.resolvePrompt();
    await runPromise;
    expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
  });

  it("cancels EVERY in-flight sub-session and lands each slot terminal-cancelled on abort", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], { signal: controller.signal })
    );

    await flush();
    // Both sub-sessions are mid-prompt; the user cancels the turn.
    controller.abort();
    // Backends honor the cancel and resolve their pending prompts.
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.resolvePrompt();
    const turn = await runPromise;

    // Every in-flight sub-session got cancel called (abort listener path).
    expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
    expect(procs.get("codex")!.cancel).toHaveBeenCalledWith({ sessionId: "s-codex" });
    // No slot is left running; an abort mid-prompt is terminal-cancelled, not done.
    expect(turn.answers.claude.status).toBe("cancelled");
    expect(turn.answers.codex.status).toBe("cancelled");
    // No summary sub-session ran after cancel (only the two answer prompts).
    expect(procs.get("claude")!.promptCount()).toBe(1);
    expect(turn.summary.status).toBe("pending");
  });

  it("clears the per-agent deadline timer on abort (no leaked timer, slot stays cancelled)", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex" },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      // Both sub-sessions reach their pending prompt(), arming a deadline timer each.
      await jest.advanceTimersByTimeAsync(0);
      // User cancels; backends honor it and resolve their pending prompts.
      controller.abort();
      procs.get("claude")!.resolvePrompt();
      procs.get("codex")!.resolvePrompt();
      const turn = await runPromise;

      // Both slots are terminal-cancelled, and the deadline timers were cleared
      // on the abort path — none survives to fire 5 min later.
      expect(turn.answers.claude.status).toBe("cancelled");
      expect(turn.answers.codex.status).toBe("cancelled");
      expect(jest.getTimerCount()).toBe(0);
      // Advancing past the deadline must not resurrect/relabel a settled slot.
      await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
      expect(turn.answers.claude.status).toBe("cancelled");
      expect(turn.answers.codex.status).toBe("cancelled");
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails a hung agent's own slot on timeout while the others complete and the summary still runs", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex" },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      // Let both sub-sessions reach their pending prompt() (newSession + mode +
      // model round-trips are microtasks under fake timers).
      await jest.advanceTimersByTimeAsync(0);
      // Claude answers and settles; codex hangs AND ignores cancel (never
      // resolves its prompt, even after the timeout fires cancel).
      procs.get("claude")!.emit(textChunk("s-claude", "Claude answer"));
      procs.get("claude")!.resolvePrompt();
      // Trip the per-agent deadline — codex's slot must error on its own.
      await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
      // codex ignores cancel, so the timeout error only lands after the cancel
      // grace elapses — the turn must NOT hang waiting on a wedged backend.
      await jest.advanceTimersByTimeAsync(FANOUT_CANCEL_GRACE_MS);
      procs.get("claude")!.resolvePrompt(); // the summary sub-session
      // The summary resolved normally, so clear its trailing-chunk grace.
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("done");
      expect(turn.answers.codex.status).toBe("error");
      expect(turn.answers.codex.error).toBe(FANOUT_AGENT_TIMEOUT_ERROR);
      // The hung sub-session was cancelled so it never leaks.
      expect(procs.get("codex")!.cancel).toHaveBeenCalledWith({ sessionId: "s-codex" });
      // The summary still ran over the survivor (claude's second prompt).
      expect(procs.get("claude")!.promptCount()).toBe(2);
      expect(turn.summary.status).toBe("done");
      // No timer survives the grace — neither the deadline nor the grace leaks.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("skips the summary when the turn is cancelled", async () => {
    const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));
    await flush();
    controller.abort();
    procs.get("claude")!.resolvePrompt();
    const turn = await runPromise;
    // Only the answer prompt ran — no summary sub-session was dispatched.
    expect(procs.get("claude")!.promptCount()).toBe(1);
    expect(turn.summary.status).toBe("pending");
  });

  it("streams the summary after all answers settle, status pending→streaming→done", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const summaryStatuses: string[] = [];
    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], {
        signal: controller.signal,
        onChange: (turn) => summaryStatuses.push(turn.summary.status),
      })
    );

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "A"));
    procs.get("codex")!.emit(textChunk("s-codex", "B"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.resolvePrompt();
    await flushPastGrace();
    // The summary sub-session is the main agent's SECOND prompt; the answer must
    // have settled before it is dispatched.
    expect(procs.get("claude")!.promptCount()).toBe(2);
    procs.get("claude")!.emit(textChunk("s-claude", "Recon"));
    procs.get("claude")!.emit(textChunk("s-claude", "ciled"));
    procs.get("claude")!.resolvePrompt();

    const turn = await runPromise;
    expect(turn.summary.text).toBe("Reconciled");
    // pending (seed) → streaming (before prompt) → ... → done (terminal).
    expect(summaryStatuses[0]).toBe("pending");
    expect(summaryStatuses).toContain("streaming");
    expect(summaryStatuses[summaryStatuses.length - 1]).toBe("done");
  });

  it("feeds the summary only succeeded answers, labeled, and omits the failed agent", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], { signal: controller.signal })
    );

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "Claude answer"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.rejectPrompt(new Error("boom"));
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    // The main agent's second prompt is the summary; inspect what it received.
    const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
    const text = summaryCall.prompt[0].text as string;
    expect(text).toContain("the original question");
    expect(text).toContain("CLAUDE");
    expect(text).toContain("Claude answer");
    // The failed agent is never fed as an answer AND never named to the
    // summarizer, so the summary can't mention or speculate about it.
    expect(text).not.toContain("CODEX");
  });

  it("lands a brief all-failed note (no fabricated summary) when zero agents succeed", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], { signal: controller.signal })
    );

    await flush();
    procs.get("claude")!.rejectPrompt(new Error("boom-a"));
    procs.get("codex")!.rejectPrompt(new Error("boom-b"));
    const turn = await runPromise;

    expect(turn.summary.status).toBe("done");
    expect(turn.summary.text).toBe(FANOUT_ALL_FAILED_SUMMARY);
    // No summary sub-session was dispatched — nothing to reconcile.
    expect(procs.get("claude")!.promptCount()).toBe(1);
    expect(procs.get("codex")!.promptCount()).toBe(1);
  });

  it("treats a done-but-empty answer as failed for summary input", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run(
      runInput(["claude", "codex"], { signal: controller.signal })
    );

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "real answer"));
    procs.get("claude")!.resolvePrompt();
    // Codex finishes cleanly but emitted no text → done-but-empty.
    procs.get("codex")!.resolvePrompt();
    await flushPastGrace();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
    const text = summaryCall.prompt[0].text as string;
    expect(text).toContain("### CLAUDE");
    // The done-but-empty agent is treated as failed: not fed as an answer and
    // not named to the summarizer.
    expect(text).not.toContain("CODEX");
  });

  it("settles a timed-out MAIN answer prompt before reusing the backend for the summary", async () => {
    jest.useFakeTimers();
    try {
      // claude is the main (reused for the summary) and times out; codex is a
      // survivor so the summary still has something to reconcile and therefore
      // DOES dispatch a second prompt on claude's backend.
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex" },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      // Both reach their pending answer prompt; codex answers and settles.
      await jest.advanceTimersByTimeAsync(0);
      procs.get("codex")!.emit(textChunk("s-codex", "codex answer"));
      procs.get("codex")!.resolvePrompt();
      // Trip the deadline for the still-pending main (claude) prompt. cancel is
      // requested, but claude's underlying prompt has NOT settled yet (the
      // backend keeps unwinding), so the orchestrator must wait inside the
      // cancel grace rather than reuse claude's backend for the summary.
      await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
      // Still only claude's answer prompt has been dispatched — the summary must
      // NOT start on the main backend while the timed-out answer is pending.
      expect(procs.get("claude")!.promptCount()).toBe(1);
      expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });

      // claude's backend now honors the cancel WITHIN the grace: the answer
      // prompt settles, unblocking the orchestrator to reuse the backend. Flush
      // the chained microtasks (timeout reject → runAgent catch → Promise.all →
      // runSummary dispatch) that follow that settlement.
      procs.get("claude")!.resolvePrompt();
      await drainMicrotasks();
      // Only now does the summary sub-session start — no overlap with the
      // still-running (timed-out) main answer prompt.
      expect(procs.get("claude")!.promptCount()).toBe(2);

      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      // The summary resolved normally, so its sub-session holds the trailing
      // chunk grace before tearing down; clear it so the run completes.
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      await drainMicrotasks();
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("error");
      expect(turn.answers.claude.error).toBe(FANOUT_AGENT_TIMEOUT_ERROR);
      expect(turn.answers.codex.status).toBe("done");
      expect(turn.summary.status).toBe("done");
      expect(turn.summary.text).toBe("summary");
      // No deadline, cancel grace, or trailing-chunk grace timer survives.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("settles (no unhandled rejection) when the cancelled MAIN prompt REJECTS rather than resolves", async () => {
    // Realistic backend behavior: a cancelled/timed-out prompt usually REJECTS
    // as it unwinds (not resolves). The settle-wait must treat that rejection as
    // "settled" AND never leak it as an unhandled rejection (the swallowed
    // prompt is awaited via a both-outcomes-mapped chain, not a bare `.finally`).
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    const onNodeUnhandled = (reason: unknown) => unhandled.push(reason);
    window.addEventListener("unhandledrejection", onUnhandled);
    process.on("unhandledRejection", onNodeUnhandled);
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex" },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      await jest.advanceTimersByTimeAsync(0);
      procs.get("codex")!.emit(textChunk("s-codex", "codex answer"));
      procs.get("codex")!.resolvePrompt();
      // Trip the main's deadline; cancel is requested but the prompt is pending.
      await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
      expect(procs.get("claude")!.promptCount()).toBe(1);

      // The backend honors the cancel within the grace by REJECTING the prompt.
      // That counts as settled: the orchestrator proceeds to reuse the backend.
      procs.get("claude")!.rejectPrompt(new Error("backend cancelled"));
      await drainMicrotasks();
      expect(procs.get("claude")!.promptCount()).toBe(2);

      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      // Clear the summary's post-resolve trailing-chunk grace so the run ends.
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      await drainMicrotasks();
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("error");
      expect(turn.answers.claude.error).toBe(FANOUT_AGENT_TIMEOUT_ERROR);
      expect(turn.summary.status).toBe("done");
      expect(turn.summary.text).toBe("summary");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      window.removeEventListener("unhandledrejection", onUnhandled);
      process.off("unhandledRejection", onNodeUnhandled);
    }
    // Give any queued unhandled-rejection events a turn to fire before asserting.
    await flush();
    expect(unhandled).toEqual([]);
  });

  it("incurs only the short trailing-chunk grace (not the cancel grace) on the happy path", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "answer"));
      // Prompt resolves on its own, well before the deadline. The summary must
      // NOT dispatch until the short trailing-chunk grace elapses (so late
      // chunks still land), but well before the much longer cancel grace.
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(0);
      expect(procs.get("claude")!.promptCount()).toBe(1);
      // The brief trailing-chunk grace is far shorter than the cancel grace, so
      // advancing the trailing window dispatches the summary…
      expect(FANOUT_TRAILING_CHUNK_GRACE_MS).toBeLessThan(FANOUT_CANCEL_GRACE_MS);
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      expect(procs.get("claude")!.promptCount()).toBe(2);

      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("done");
      expect(turn.answers.claude.text).toBe("answer");
      expect(turn.summary.status).toBe("done");
      // Deadline + trailing-grace timers all cleared on the resolve path.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("awaits the underlying prompt settlement on abort before reusing the backend, slot terminal-cancelled", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      // User cancels mid-prompt: cancel is requested but the underlying prompt
      // is still pending, so the abort path waits inside the grace.
      controller.abort();
      await jest.advanceTimersByTimeAsync(0);
      expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
      // The run does not finish while the answer prompt is still unwinding.
      let finished = false;
      void runPromise.then(() => (finished = true));
      await jest.advanceTimersByTimeAsync(0);
      expect(finished).toBe(false);

      // Backend honors the cancel within the grace; the prompt settles.
      procs.get("claude")!.resolvePrompt();
      const turn = await runPromise;

      // Abort still yields a terminal-cancelled slot, and no summary ran.
      expect(turn.answers.claude.status).toBe("cancelled");
      expect(procs.get("claude")!.promptCount()).toBe(1);
      expect(turn.summary.status).toBe("pending");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("captures a trailing chunk flushed AFTER prompt resolves, within the grace, into the slot", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "first part "));
      // The backend resolves the prompt, THEN (like opencode / fast models)
      // flushes the turn's final chunk just after — while still inside the
      // trailing-chunk grace, before the handler is torn down.
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS - 1);
      procs.get("claude")!.emit(textChunk("s-claude", "trailing tail"));
      // Let the grace elapse and the summary run.
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      const turn = await runPromise;

      // The trailing chunk landed in the SAME slot — not dropped.
      expect(turn.answers.claude.status).toBe("done");
      expect(turn.answers.claude.text).toBe("first part trailing tail");
      expect(turn.summary.text).toBe("summary");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("captures a trailing summary chunk flushed after the summary prompt resolves", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "answer"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      // The summary sub-session resolves, then flushes its final chunk within
      // the grace — it must still append to the summary slot.
      procs.get("claude")!.emit(textChunk("s-claude", "Summ"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS - 1);
      procs.get("claude")!.emit(textChunk("s-claude", "ary tail"));
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      const turn = await runPromise;

      expect(turn.summary.text).toBe("Summary tail");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("suppresses a late chunk on cancel — no trailing grace, output dropped", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "partial"));
      // User cancels; the backend honors it and resolves the in-flight prompt.
      controller.abort();
      procs.get("claude")!.resolvePrompt();
      // A late chunk arrives, but the cancel path tears the handler down
      // immediately (no trailing grace), so it must NOT land.
      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "late dropped"));
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("cancelled");
      expect(turn.answers.claude.text).toBe("partial");
      // No summary ran on cancel and no timer leaked.
      expect(turn.summary.status).toBe("pending");
      expect(procs.get("claude")!.promptCount()).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("lands a slot cancelled PROMPTLY when its newSession is wedged and the run aborts (no prompt, no hang)", async () => {
    jest.useFakeTimers();
    try {
      // codex's backend is cold: its `newSession` never returns, so the agent is
      // stuck in SETUP — the only protection that matters is the abort race,
      // since there is no prompt to time out yet. claude answers normally.
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex", controlledNewSession: true },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      // claude reaches + settles its prompt; codex is blocked in `newSession`.
      await jest.advanceTimersByTimeAsync(0);
      expect(procs.get("codex")!.promptCount()).toBe(0); // never got past setup
      procs.get("claude")!.emit(textChunk("s-claude", "claude answer"));
      procs.get("claude")!.resolvePrompt();

      // The user cancels while codex is still wedged in setup. The slot must
      // settle PROMPTLY — without waiting on the stuck `newSession` — so the turn
      // completes instead of spinning forever behind the cold backend.
      controller.abort();
      // No real wall-clock advance needed for the wedged agent: only the cancel
      // path drives it. (claude's trailing grace was suppressed by the abort.)
      const turn = await runPromise;

      expect(turn.answers.codex.status).toBe("cancelled");
      expect(turn.answers.claude.status).toBe("cancelled");
      // codex never dispatched a prompt — it never escaped setup.
      expect(procs.get("codex")!.promptCount()).toBe(0);
      // Aborted run skips the summary.
      expect(turn.summary.status).toBe("pending");
      // No deadline timer survives the abort.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("settles without launching agents when the run signal is ALREADY aborted before dispatch", async () => {
    jest.useFakeTimers();
    try {
      // Stop was pressed during the async work BEFORE fan-out dispatch (e.g.
      // license re-verify), so the signal is already aborted when run() starts.
      // The abort listener armed inside the helper would never fire for an
      // already-fired signal, so the upfront `signal.aborted` check must settle
      // each agent without opening a sub-session or dispatching a prompt.
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex" },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      controller.abort();

      const turn = await orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      // No agent opened a sub-session or dispatched a prompt after Stop.
      expect(procs.get("claude")!.newSessionCount()).toBe(0);
      expect(procs.get("codex")!.newSessionCount()).toBe(0);
      expect(procs.get("claude")!.promptCount()).toBe(0);
      expect(procs.get("codex")!.promptCount()).toBe(0);
      // Both slots terminal-cancelled; the aborted run skips the summary; no leak.
      expect(turn.answers.claude.status).toBe("cancelled");
      expect(turn.answers.codex.status).toBe("cancelled");
      expect(turn.summary.status).toBe("pending");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("tears down a sub-session whose newSession resolves AFTER the abort already bailed (no orphan)", async () => {
    jest.useFakeTimers();
    try {
      // codex is wedged in `newSession` when the run aborts; the slot settles
      // without it. LATER the backend finally returns the session — that late
      // sub-session must still be cancelled so nothing leaks behind the bail.
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex", controlledNewSession: true },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.resolvePrompt();
      controller.abort();
      const turn = await runPromise;
      expect(turn.answers.codex.status).toBe("cancelled");
      // The late session had not been created yet, so nothing was cancelled.
      expect(procs.get("codex")!.cancel).not.toHaveBeenCalled();

      // The cold backend now returns the session AFTER the slot is terminal. The
      // attempt resumes, finds the run already aborted, and tears the orphaned
      // sub-session down (its dispatched prompt is cancelled, then closed).
      procs.get("codex")!.resolveNewSession();
      await jest.advanceTimersByTimeAsync(0);
      expect(procs.get("codex")!.cancel).toHaveBeenCalledWith({ sessionId: "s-codex" });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails a slot with the timeout error when SETUP (not just the prompt) exceeds the deadline", async () => {
    jest.useFakeTimers();
    try {
      // codex's `newSession` never resolves; the WHOLE-attempt deadline (which
      // now covers setup, not only the prompt) must fail codex's own slot while
      // claude — which answered — is unaffected and the summary still runs.
      const { host, procs } = makeHost({
        claude: { sessionId: "s-claude" },
        codex: { sessionId: "s-codex", controlledNewSession: true },
      });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(
        runInput(["claude", "codex"], { signal: controller.signal })
      );

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "claude answer"));
      procs.get("claude")!.resolvePrompt();
      // Trip the per-agent deadline while codex is still in setup. No prompt is
      // in flight, so the slot errors immediately (no cancel grace to wait out).
      await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
      // The summary runs over the survivor (claude's second prompt); settle it.
      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(FANOUT_TRAILING_CHUNK_GRACE_MS);
      await drainMicrotasks();
      const turn = await runPromise;

      expect(turn.answers.codex.status).toBe("error");
      expect(turn.answers.codex.error).toBe(FANOUT_AGENT_TIMEOUT_ERROR);
      expect(turn.answers.claude.status).toBe("done");
      expect(turn.summary.status).toBe("done");
      expect(turn.summary.text).toBe("summary");
      // codex never dispatched a prompt (it never left setup).
      expect(procs.get("codex")!.promptCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
