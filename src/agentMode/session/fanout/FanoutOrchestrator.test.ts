import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
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
}

/**
 * Mock backend process whose `prompt` stays pending until the test resolves it,
 * so streamed events can land before the turn settles. `sessionId` is fixed per
 * backend so the orchestrator's per-session handler routing is exercised. Each
 * `prompt` call pushes its own resolver, so the answer turn and the later
 * summary turn (a second sub-session on the main backend) resolve independently;
 * `resolvePrompt`/`rejectPrompt` settle the oldest still-pending prompt.
 */
function makeMockProc(sessionId: string): MockProc {
  let handler: SessionUpdateHandler | null = null;
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
  const setSessionConfigOption = jest.fn(async () => ({ model: null, mode: null }));
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
    newSession: jest.fn(async () => ({ sessionId, state: { model: null, mode: null } })),
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
    { sessionId: string; readOnlyModeId?: string; effortConfig?: { id: string } }
  >,
  defaults: Partial<Record<BackendId, ModelSelection>> = {}
): HostHarness {
  const procs = new Map<BackendId, MockProc>();
  const descriptors = new Map<BackendId, BackendDescriptor>();
  for (const [id, { sessionId, readOnlyModeId, effortConfig }] of Object.entries(config)) {
    procs.set(id, makeMockProc(sessionId));
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
 * Drain a long chain of dependent microtasks under fake timers. A single
 * `advanceTimersByTimeAsync(0)` flushes only one microtask wave; the
 * timeout-reject → runAgent catch → Promise.all → runSummary dispatch path
 * spans several, so we pump a handful of waves.
 */
const drainMicrotasks = async () => {
  for (let i = 0; i < 8; i++) await jest.advanceTimersByTimeAsync(0);
};

/**
 * Build a `run` input with the Phase 3 fields defaulted: `mainAgent` is the
 * first agent (the session main, per Phase 1) and `originalPromptText` is a
 * fixed question. Tests override fields as needed.
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
    // Answers settled; the main agent (claude) now opens a summary sub-session.
    await flush();
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
    // The main agent (claude) summarizes over the one survivor.
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
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
      await jest.advanceTimersByTimeAsync(0);
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
    await flush();
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

  it("feeds the summary only succeeded answers, labeled, and names the failed agent", async () => {
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
    await flush();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    // The main agent's second prompt is the summary; inspect what it received.
    const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
    const text = summaryCall.prompt[0].text as string;
    expect(text).toContain("the original question");
    expect(text).toContain("CLAUDE");
    expect(text).toContain("Claude answer");
    // The failed agent is named, never fed as an answer.
    expect(text).toContain("did not return an answer: CODEX");
    expect(text).not.toContain("### CODEX");
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
    await flush();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
    const text = summaryCall.prompt[0].text as string;
    expect(text).toContain("### CLAUDE");
    expect(text).toContain("did not return an answer: CODEX");
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
      await drainMicrotasks();
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("error");
      expect(turn.answers.claude.error).toBe(FANOUT_AGENT_TIMEOUT_ERROR);
      expect(turn.answers.codex.status).toBe("done");
      expect(turn.summary.status).toBe("done");
      expect(turn.summary.text).toBe("summary");
      // No deadline or grace timer survives once the prompt settled in-grace.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not incur the cancel grace on the happy path (prompt resolves normally)", async () => {
    jest.useFakeTimers();
    try {
      const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
      const orchestrator = new FanoutOrchestrator(host);
      const controller = new AbortController();
      const runPromise = orchestrator.run(runInput(["claude"], { signal: controller.signal }));

      await jest.advanceTimersByTimeAsync(0);
      procs.get("claude")!.emit(textChunk("s-claude", "answer"));
      // Prompt resolves on its own, well before the deadline. The summary must
      // dispatch immediately, with NO wall-clock advance through the grace.
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(0);
      expect(procs.get("claude")!.promptCount()).toBe(2);

      procs.get("claude")!.emit(textChunk("s-claude", "summary"));
      procs.get("claude")!.resolvePrompt();
      await jest.advanceTimersByTimeAsync(0);
      const turn = await runPromise;

      expect(turn.answers.claude.status).toBe("done");
      expect(turn.answers.claude.text).toBe("answer");
      expect(turn.summary.status).toBe("done");
      // Deadline timers cleared on the resolve path; nothing waited the grace.
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
});
