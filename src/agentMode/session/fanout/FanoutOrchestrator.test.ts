import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  ModelSelection,
  PromptInput,
  SessionEvent,
  SessionUpdateHandler,
  TurnEnd,
} from "@/agentMode/session/types";
import { createFanoutTurn, FanoutOrchestrator, type FanoutHost } from "./FanoutOrchestrator";
import {
  FANOUT_AGENT_TIMEOUT_ERROR,
  FANOUT_AGENT_TIMEOUT_MS,
  FANOUT_ALL_FAILED_SUMMARY,
} from "./fanoutTypes";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/agentMode/sdk/effortOption", () => ({
  ...jest.requireActual("@/agentMode/sdk/effortOption"),
  getCachedSdkCatalog: () => [
    { value: "claude-sonnet-4-5", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
  ],
}));

interface MockProc {
  proc: BackendProcess;
  emit: (event: SessionEvent) => void;
  setSessionMode: jest.Mock;
  cancel: jest.Mock;
  closeSession: jest.Mock;
  cancelled: () => Promise<void>;
  resolvePrompt: () => void;
  rejectPrompt: (err: unknown) => void;
  endTurnsAtOnce: (onPrompt?: () => void) => void;
  promptCount: () => number;
  prompted: (count: number) => Promise<void>;
}

function makeMockProc(sessionId: string): MockProc {
  let handler: SessionUpdateHandler | null = null;
  const emptyState = (): BackendState => ({ model: null, mode: null });
  const pending: Array<{
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];
  let accepted = 0;
  const promptWaiters: Array<{ count: number; resolve: () => void }> = [];
  const endTurn = (promptId: string, turnEnd: Omit<TurnEnd, "turnId">) =>
    handler?.({ sessionId, update: { sessionUpdate: "turn_ended", turnId: promptId, ...turnEnd } });
  const acceptPrompt = async ({ promptId }: PromptInput): Promise<void> => {
    const end = (turnEnd: Omit<TurnEnd, "turnId">) => endTurn(promptId, turnEnd);
    pending.push({
      resolve: () => end({ stopReason: "end_turn" }),
      reject: (error) => end({ stopReason: "end_turn", error: error as Error }),
    });
    accepted += 1;
    for (const waiter of promptWaiters.filter((w) => w.count <= accepted)) waiter.resolve();
  };
  const settleOldest = (
    apply: (p: { resolve: () => void; reject: (e: unknown) => void }) => void
  ) => {
    const next = pending.shift();
    if (next) apply(next);
  };
  const setSessionMode = jest.fn(async () => ({ model: null, mode: null }));
  let markCancelled!: () => void;
  const cancelledOnce = new Promise<void>((resolve) => (markCancelled = resolve));
  const cancel = jest.fn(async () => markCancelled());
  const closeSession = jest.fn(async () => undefined);
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
    newSession: jest.fn(() => Promise.resolve({ sessionId, state: emptyState() })),
    prompt: jest.fn(acceptPrompt),
    cancel,
    closeSession,
    setSessionModel: jest.fn(async () => ({ model: null, mode: null })),
    isSetSessionModelSupported: () => true,
    setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: jest.fn(async () => ({ model: null, mode: null })),
    isSetSessionConfigOptionSupported: () => true,
    listSessions: jest.fn(async () => ({ sessions: [] })),
    resumeSession: jest.fn(),
    loadSession: jest.fn(),
    shutdown: async () => {},
  } as unknown as BackendProcess;
  return {
    proc,
    emit: (event) => handler?.(event),
    setSessionMode,
    cancel,
    closeSession,
    cancelled: () => cancelledOnce,
    resolvePrompt: () => settleOldest((p) => p.resolve()),
    rejectPrompt: (err) => settleOldest((p) => p.reject(err)),
    endTurnsAtOnce: (onPrompt) =>
      jest.mocked(proc.prompt).mockImplementation(async ({ promptId }) => {
        onPrompt?.();
        endTurn(promptId, { stopReason: "end_turn" });
      }),
    promptCount: () => (proc.prompt as jest.Mock).mock.calls.length,
    prompted: (count) =>
      count <= accepted
        ? Promise.resolve()
        : new Promise<void>((resolve) => promptWaiters.push({ count, resolve })),
  };
}

function descriptorFor(id: BackendId, readOnlyModeId?: string): BackendDescriptor {
  return {
    id,
    wire: { encode: (s: ModelSelection) => `${s.baseModelId}/${s.effort ?? "default"}` },
    getModeMapping: readOnlyModeId
      ? () => ({
          kind: "setMode" as const,
          canonical: { plan: "plan", default: "auto" },
          readOnlyModeId,
        })
      : undefined,
  } as unknown as BackendDescriptor;
}

function opencodeEnabling(baseModelIds: string[]): BackendDescriptor {
  return {
    ...OpencodeBackendDescriptor,
    getEnabledModelEntries: () =>
      baseModelIds.map((baseModelId) => ({
        baseModelId,
        name: baseModelId,
        credentialState: "ok" as const,
      })),
  };
}

function update(sessionId: string, sessionUpdate: SessionEvent["update"]): SessionEvent {
  return { sessionId, update: sessionUpdate };
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
  excludedFromHistory: Array<{ backendId: BackendId; sessionId: string }>;
}

function makeHost(
  config: Record<BackendId, { sessionId: string; readOnlyModeId?: string }>
): HostHarness {
  const procs = new Map<BackendId, MockProc>();
  const descriptors = new Map<BackendId, BackendDescriptor>();
  for (const [id, { sessionId, readOnlyModeId }] of Object.entries(config)) {
    procs.set(id, makeMockProc(sessionId));
    descriptors.set(id, descriptorFor(id, readOnlyModeId));
  }
  const readOnlyRegistered: string[] = [];
  const readOnlyUnregistered: string[] = [];
  const excludedFromHistory: Array<{ backendId: BackendId; sessionId: string }> = [];
  const host: FanoutHost = {
    ensureBackendForFanout: async (backendId) => ({
      proc: procs.get(backendId)!.proc,
      descriptor: descriptors.get(backendId)!,
    }),
    getDefaultSelection: () => null,
    getDisplayName: (backendId) => backendId.toUpperCase(),
    getCwd: () => "/vault",
    registerReadOnlySession: (sessionId) => {
      readOnlyRegistered.push(sessionId);
      return () => readOnlyUnregistered.push(sessionId);
    },
    excludeSubSessionFromHistory: (backendId, sessionId) => {
      excludedFromHistory.push({ backendId, sessionId });
    },
  };
  return { host, procs, readOnlyRegistered, readOnlyUnregistered, excludedFromHistory };
}

const flush = () => new Promise((r) => window.setTimeout(r, 0));

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

describe("FanoutOrchestrator", () => {
  describe("createFanoutTurn()", () => {
    it("seeds one running slot per agent (insertion order) plus a pending summary", () => {
      const turn = createFanoutTurn(["opencode", "claude", "codex"]);
      expect(Object.keys(turn.answers)).toEqual(["opencode", "claude", "codex"]);
      expect(turn.answers.claude).toEqual({ backendId: "claude", status: "running", text: "" });
      expect(turn.summary).toEqual({ status: "pending", text: "" });
    });
  });

  describe("FanoutOrchestrator", () => {
    describe("run()", () => {
      it("streams each agent's answer into its own slot and marks them done", async () => {
        const { host, procs, readOnlyRegistered, readOnlyUnregistered, excludedFromHistory } =
          makeHost({
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

        await Promise.all([procs.get("claude")!.prompted(1), procs.get("codex")!.prompted(1)]);
        procs.get("claude")!.emit(textChunk("s-claude", "Claude says hi"));
        procs.get("codex")!.emit(textChunk("s-codex", "Codex says hi"));
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.resolvePrompt();
        await procs.get("claude")!.prompted(2);
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
        expect(readOnlyRegistered.sort()).toEqual(["s-claude", "s-claude", "s-codex"]);
        expect(readOnlyUnregistered.sort()).toEqual(["s-claude", "s-claude", "s-codex"]);
        expect(excludedFromHistory.map((e) => e.sessionId).sort()).toEqual([
          "s-claude",
          "s-claude",
          "s-codex",
        ]);
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

        await Promise.all([procs.get("claude")!.prompted(1), procs.get("codex")!.prompted(1)]);
        procs.get("claude")!.emit(textChunk("s-claude", "ok"));
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.rejectPrompt(new Error("backend boom"));
        await procs.get("claude")!.prompted(2);
        procs.get("claude")!.resolvePrompt();

        const turn = await runPromise;
        expect(turn.answers.claude.status).toBe("done");
        expect(turn.answers.codex.status).toBe("error");
        expect(turn.answers.codex.error).toContain("backend boom");
        const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
        const text = summaryCall.prompt[0].text as string;
        expect(text).toContain("the original question");
        expect(text).toContain("CLAUDE");
        expect(text).not.toContain("CODEX");
      });

      it("applies the read-only sandbox id (never plan) only for backends that advertise one", async () => {
        const { host, procs } = makeHost({
          codex: { sessionId: "s-codex", readOnlyModeId: "read-only" },
          opencode: { sessionId: "s-opencode" },
        });
        const orchestrator = new FanoutOrchestrator(host);
        const controller = new AbortController();

        const runPromise = orchestrator.run(
          runInput(["codex", "opencode"], { signal: controller.signal })
        );
        await Promise.all([procs.get("codex")!.prompted(1), procs.get("opencode")!.prompted(1)]);
        procs.get("codex")!.resolvePrompt();
        procs.get("opencode")!.resolvePrompt();
        await runPromise;

        expect(procs.get("codex")!.setSessionMode).toHaveBeenCalledWith({
          sessionId: "s-codex",
          modeId: "read-only",
        });
        expect(procs.get("codex")!.setSessionMode).not.toHaveBeenCalledWith({
          sessionId: "s-codex",
          modeId: "plan",
        });
        expect(procs.get("opencode")!.setSessionMode).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 cancels and closes EVERY in-flight sub-session and lands each slot terminal-cancelled on abort", async () => {
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          codex: { sessionId: "s-codex" },
        });
        const orchestrator = new FanoutOrchestrator(host);
        const controller = new AbortController();
        const runPromise = orchestrator.run(
          runInput(["claude", "codex"], { signal: controller.signal })
        );

        await Promise.all([procs.get("claude")!.prompted(1), procs.get("codex")!.prompted(1)]);
        controller.abort();
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.resolvePrompt();
        const turn = await runPromise;

        expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
        expect(procs.get("codex")!.cancel).toHaveBeenCalledWith({ sessionId: "s-codex" });
        expect(procs.get("claude")!.closeSession).toHaveBeenCalledWith({ sessionId: "s-claude" });
        expect(procs.get("codex")!.closeSession).toHaveBeenCalledWith({ sessionId: "s-codex" });
        expect(turn.answers.claude.status).toBe("cancelled");
        expect(turn.answers.codex.status).toBe("cancelled");
        expect(procs.get("claude")!.promptCount()).toBe(1);
        expect(turn.summary.status).toBe("pending");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 closes every answer and summary sub-session once it is final, including a failed one", async () => {
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          codex: { sessionId: "s-codex" },
        });
        const runPromise = new FanoutOrchestrator(host).run(runInput(["claude", "codex"]));

        await Promise.all([procs.get("claude")!.prompted(1), procs.get("codex")!.prompted(1)]);
        procs.get("claude")!.emit(textChunk("s-claude", "ok"));
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.rejectPrompt(new Error("backend boom"));
        await procs.get("claude")!.prompted(2);
        procs.get("claude")!.resolvePrompt();
        await runPromise;

        expect(procs.get("claude")!.closeSession.mock.calls).toEqual([
          [{ sessionId: "s-claude" }],
          [{ sessionId: "s-claude" }],
        ]);
        expect(procs.get("codex")!.closeSession).toHaveBeenCalledWith({ sessionId: "s-codex" });
      });

      it(`waits for an answer's background task and includes the reply that reports it as a new paragraph, leaving the task's own text out (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)`, async () => {
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          codex: { sessionId: "s-codex" },
        });
        const claude = procs.get("claude")!;
        const runPromise = new FanoutOrchestrator(host).run(runInput(["claude", "codex"]));

        await Promise.all([claude.prompted(1), procs.get("codex")!.prompted(1)]);
        claude.emit(update("s-claude", { sessionUpdate: "turn_started", turnId: "t1" }));
        claude.emit(textChunk("s-claude", "Launched a helper."));
        claude.emit(
          update("s-claude", {
            sessionUpdate: "task_started",
            taskId: "task-1",
            toolCallId: "call-1",
            kind: "subagent",
            description: "Read Welcome",
          })
        );
        claude.resolvePrompt();
        procs.get("codex")!.resolvePrompt();
        await procs.get("codex")!.cancelled();
        claude.emit({ ...textChunk("s-claude", "helper's own notes"), taskToolCallId: "call-1" });
        claude.emit(
          update("s-claude", { sessionUpdate: "task_ended", taskId: "task-1", status: "completed" })
        );
        claude.emit(update("s-claude", { sessionUpdate: "turn_started", turnId: "t2" }));
        claude.emit(textChunk("s-claude", "REPORT: it says hello."));
        claude.emit(
          update("s-claude", { sessionUpdate: "turn_ended", turnId: "t2", stopReason: "end_turn" })
        );
        await claude.prompted(2);
        claude.resolvePrompt();
        const turn = await runPromise;

        expect(turn.answers.claude).toEqual({
          backendId: "claude",
          status: "done",
          text: "Launched a helper.\n\nREPORT: it says hello.",
        });
      });

      it(`ends an answer whose background task never ends at the per-agent timeout, keeping its text and closing its sub-session (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)`, async () => {
        jest.useFakeTimers();
        try {
          const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
          const claude = procs.get("claude")!;
          const runPromise = new FanoutOrchestrator(host).run(runInput(["claude"]));

          await claude.prompted(1);
          claude.emit(textChunk("s-claude", "Launched a helper."));
          claude.emit(
            update("s-claude", {
              sessionUpdate: "task_started",
              taskId: "task-1",
              toolCallId: "call-1",
              kind: "subagent",
              description: "Never finishes",
            })
          );
          claude.resolvePrompt();
          await jest.advanceTimersByTimeAsync(FANOUT_AGENT_TIMEOUT_MS);
          const turn = await runPromise;

          expect(turn.answers.claude).toEqual({
            backendId: "claude",
            status: "error",
            text: "Launched a helper.",
            error: expect.stringContaining(FANOUT_AGENT_TIMEOUT_ERROR),
          });
          expect(claude.closeSession).toHaveBeenCalledWith({ sessionId: "s-claude" });
        } finally {
          jest.useRealTimers();
        }
      });

      it(`ends an answer waiting on a background task with the disconnect error when the agent exits, keeping its text (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)`, async () => {
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
        const claude = procs.get("claude")!;
        const runPromise = new FanoutOrchestrator(host).run(runInput(["claude"]));

        await claude.prompted(1);
        claude.emit(textChunk("s-claude", "Launched a helper."));
        claude.emit(
          update("s-claude", {
            sessionUpdate: "task_started",
            taskId: "task-1",
            toolCallId: "call-1",
            kind: "subagent",
            description: "Slow helper",
          })
        );
        claude.resolvePrompt();
        claude.emit(
          update("s-claude", { sessionUpdate: "task_ended", taskId: "task-1", status: "stopped" })
        );
        claude.emit(
          update("s-claude", {
            sessionUpdate: "session_disconnected",
            error: new Error("Claude exited"),
          })
        );
        const turn = await runPromise;

        expect(turn.answers.claude).toEqual({
          backendId: "claude",
          status: "error",
          text: "Launched a helper.",
          error: expect.stringContaining("Claude exited"),
        });
      });

      it(`stops waiting for a background task on abort and closes the sub-session so the task ends with it (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)`, async () => {
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
        const claude = procs.get("claude")!;
        const controller = new AbortController();
        const runPromise = new FanoutOrchestrator(host).run(
          runInput(["claude"], { signal: controller.signal })
        );

        await claude.prompted(1);
        claude.emit(
          update("s-claude", {
            sessionUpdate: "task_started",
            taskId: "task-1",
            toolCallId: "call-1",
            kind: "subagent",
            description: "Slow helper",
          })
        );
        claude.resolvePrompt();
        controller.abort();
        const turn = await runPromise;

        expect(turn.answers.claude.status).toBe("cancelled");
        expect(claude.closeSession).toHaveBeenCalledWith({ sessionId: "s-claude" });
      });

      it(`closes the sub-session on abort when the stopped prompt never starts a turn (https://github.com/Brevilabs/obsidian-copilot-private/issues/175)`, async () => {
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
        const claude = procs.get("claude")!;
        const controller = new AbortController();
        const runPromise = new FanoutOrchestrator(host).run(
          runInput(["claude"], { signal: controller.signal })
        );

        await claude.prompted(1);
        controller.abort();
        const turn = await runPromise;

        expect(turn.answers.claude.status).toBe("cancelled");
        expect(claude.closeSession).toHaveBeenCalledWith({ sessionId: "s-claude" });
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

        await Promise.all([procs.get("claude")!.prompted(1), procs.get("codex")!.prompted(1)]);
        procs.get("claude")!.rejectPrompt(new Error("boom-a"));
        procs.get("codex")!.rejectPrompt(new Error("boom-b"));
        const turn = await runPromise;

        expect(turn.summary.status).toBe("done");
        expect(turn.summary.text).toBe(FANOUT_ALL_FAILED_SUMMARY);
        expect(procs.get("claude")!.promptCount()).toBe(1);
        expect(procs.get("codex")!.promptCount()).toBe(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 returns one mentioned agent's answer without dispatching a summary", async () => {
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          opencode: { sessionId: "s-opencode" },
        });
        const proc = procs.get("claude")!;
        proc.endTurnsAtOnce(() => proc.emit(textChunk("s-claude", "Claude answered directly")));

        const turn = await new FanoutOrchestrator(host).run(
          runInput(["claude"], { mainAgent: "opencode" })
        );

        expect(proc.proc.prompt).toHaveBeenCalledTimes(1);
        expect(procs.get("opencode")!.proc.newSession).not.toHaveBeenCalled();
        expect(procs.get("opencode")!.proc.prompt).not.toHaveBeenCalled();
        expect(turn.answers.claude).toMatchObject({
          status: "done",
          text: "Claude answered directly",
        });
        expect(turn.summary).toEqual({ status: "done", text: "" });
      });

      function configureCodex(proc: BackendProcess): void {
        const state: BackendState = {
          mode: null,
          model: {
            current: { baseModelId: "original", effort: "low" },
            apply: {
              kind: "setConfigOption",
              configId: "model",
              effortConfigId: "reasoning_effort",
            },
            availableModels: [
              {
                baseModelId: "example",
                name: "Example",
                provider: null,
                effortOptions: [
                  { value: "low", label: "low" },
                  { value: "high", label: "high" },
                ],
              },
            ],
          },
        };
        jest.mocked(proc.newSession).mockResolvedValue({ sessionId: "s-codex", state });
        jest.mocked(proc.setSessionConfigOption).mockResolvedValue(state);
      }

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/550 applies explicit Codex effort to both answer and summary sessions", async () => {
        const { host, procs } = makeHost({
          codex: { sessionId: "s-codex" },
          claude: { sessionId: "s-claude" },
        });
        const proc = procs.get("codex")!.proc;
        configureCodex(proc);
        host.ensureBackendForFanout = async (backendId) =>
          backendId === "codex"
            ? { proc, descriptor: CodexBackendDescriptor }
            : {
                proc: procs.get(backendId)!.proc,
                descriptor: descriptorFor(backendId),
              };
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: "high" });
        procs
          .get("codex")!
          .endTurnsAtOnce(() => procs.get("codex")!.emit(textChunk("s-codex", "answer")));
        procs.get("claude")!.endTurnsAtOnce();
        await new FanoutOrchestrator(host).run(runInput(["codex", "claude"]));
        expect(proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-codex",
          configId: "model",
          value: "example",
        });
        expect(proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-codex",
          configId: "reasoning_effort",
          value: "high",
        });
        expect(proc.setSessionConfigOption).toHaveBeenCalledTimes(4);
        expect(proc.setSessionModel).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/550 reports a rejected model config switch rather than running fan-out on a different model", async () => {
        const { host, procs } = makeHost({ codex: { sessionId: "s-codex" } });
        const proc = procs.get("codex")!.proc;
        configureCodex(proc);
        host.ensureBackendForFanout = async () => ({ proc, descriptor: CodexBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: null });
        jest.mocked(proc.setSessionConfigOption).mockRejectedValue(new Error("Model unavailable"));
        const result = await new FanoutOrchestrator(host).run(runInput(["codex"]));
        expect(result.answers.codex.status).toBe("error");
        expect(result.answers.codex.error).toContain("Model unavailable");
        expect(proc.prompt).not.toHaveBeenCalled();
        expect(proc.setSessionModel).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/550 exposes a summary-only model selection failure while preserving successful answers", async () => {
        const { host, procs } = makeHost({
          codex: { sessionId: "s-codex" },
          claude: { sessionId: "s-claude" },
        });
        const proc = procs.get("codex")!.proc;
        configureCodex(proc);
        host.ensureBackendForFanout = async (backendId) =>
          backendId === "codex"
            ? { proc, descriptor: CodexBackendDescriptor }
            : {
                proc: procs.get(backendId)!.proc,
                descriptor: descriptorFor(backendId),
              };
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: "high" });
        const successState = await proc.setSessionConfigOption({
          sessionId: "s-codex",
          configId: "model",
          value: "example",
        });
        jest
          .mocked(proc.setSessionConfigOption)
          .mockResolvedValueOnce(successState)
          .mockResolvedValueOnce(successState)
          .mockRejectedValueOnce(new Error("Model unavailable"));
        procs
          .get("codex")!
          .endTurnsAtOnce(() =>
            procs.get("codex")!.emit(textChunk("s-codex", "Successful answer"))
          );
        procs.get("claude")!.endTurnsAtOnce();

        const result = await new FanoutOrchestrator(host).run(runInput(["codex", "claude"]));

        expect(result.answers.codex).toMatchObject({ status: "done", text: "Successful answer" });
        expect(result.summary.status).toBe("done");
        expect(result.summary.error).toContain("Model unavailable");
        expect(result.summary.complete).not.toBe(true);
        expect(proc.prompt).toHaveBeenCalledTimes(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies and reports the lowest OpenCode effort before both answer and summary prompts", async () => {
        const { host, procs } = makeHost({
          opencode: { sessionId: "s-opencode" },
          claude: { sessionId: "s-claude" },
        });
        const proc = procs.get("opencode")!.proc;
        const state: BackendState = {
          model: {
            current: { baseModelId: "provider/model", effort: "high" },
            availableModels: [
              {
                baseModelId: "provider/model",
                name: "Model",
                provider: "provider",
                effortOptions: [
                  { value: "high", label: "High" },
                  { value: "low", label: "Low" },
                ],
              },
            ],
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
          },
          mode: null,
        };
        host.ensureBackendForFanout = async (backendId) =>
          backendId === "opencode"
            ? { proc, descriptor: opencodeEnabling(["provider/model"]) }
            : {
                proc: procs.get(backendId)!.proc,
                descriptor: descriptorFor(backendId),
              };
        host.getDefaultSelection = (backendId) =>
          backendId === "opencode" ? { baseModelId: "provider/model", effort: null } : null;
        jest.mocked(proc.newSession).mockResolvedValue({ sessionId: "s-opencode", state });
        const confirmed = {
          ...state,
          model: { ...state.model!, current: { baseModelId: "provider/model", effort: "low" } },
        };
        host.onSelectionApplied = jest.fn();
        jest.mocked(proc.setSessionConfigOption).mockResolvedValue(confirmed);
        procs
          .get("opencode")!
          .endTurnsAtOnce(() => procs.get("opencode")!.emit(textChunk("s-opencode", "answer")));
        procs.get("claude")!.endTurnsAtOnce();

        await new FanoutOrchestrator(host).run(runInput(["opencode", "claude"]));

        expect(jest.mocked(proc.setSessionConfigOption).mock.calls).toEqual([
          [{ sessionId: "s-opencode", configId: "effort", value: "low" }],
          [{ sessionId: "s-opencode", configId: "effort", value: "low" }],
        ]);
        expect(host.onSelectionApplied).toHaveBeenCalledWith("opencode", confirmed);
        expect(proc.prompt).toHaveBeenCalledTimes(2);
        expect(proc.setSessionModel).not.toHaveBeenCalled();
      });

      it.each([true, false])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 uses OpenCode's refreshed effort capability after selecting the model, offered=%s",
        async (offered) => {
          const { host, procs } = makeHost({ opencode: { sessionId: "s-opencode" } });
          const proc = procs.get("opencode")!.proc;
          const initial: BackendState = {
            model: {
              current: { baseModelId: "provider/old", effort: null },
              availableModels: [
                {
                  baseModelId: "provider/new",
                  name: "New",
                  provider: "provider",
                  effortOptions: [
                    { value: "high", label: "High" },
                    { value: "low", label: "Low" },
                  ],
                },
              ],
              apply: { kind: "setConfigOption", configId: "model", effortConfigId: "old-effort" },
            },
            mode: null,
          };
          const refreshed: BackendState = {
            model: {
              current: { baseModelId: "provider/new", effort: null },
              availableModels: [
                {
                  baseModelId: "provider/new",
                  name: "New",
                  provider: null,
                  effortOptions: offered ? [{ value: "high", label: "high" }] : [],
                },
              ],
              apply: { kind: "setConfigOption", configId: "model", effortConfigId: "new-effort" },
            },
            mode: null,
          };
          host.ensureBackendForFanout = async () => ({
            proc,
            descriptor: opencodeEnabling(["provider/new"]),
          });
          host.getDefaultSelection = () => ({ baseModelId: "provider/new", effort: "high" });
          jest
            .mocked(proc.newSession)
            .mockResolvedValue({ sessionId: "s-opencode", state: initial });
          jest.mocked(proc.setSessionConfigOption).mockResolvedValue(refreshed);
          procs.get("opencode")!.endTurnsAtOnce();

          await new FanoutOrchestrator(host).run(runInput(["opencode"]));

          expect(proc.setSessionModel).not.toHaveBeenCalled();
          expect(jest.mocked(proc.setSessionConfigOption).mock.calls).toEqual([
            [{ sessionId: "s-opencode", configId: "model", value: "provider/new" }],
            ...(offered
              ? [[{ sessionId: "s-opencode", configId: "new-effort", value: "high" }]]
              : []),
          ]);
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 waits for OpenCode's late catalog to list the enabled default before switching and prompting", async () => {
        const { host, procs } = makeHost({ opencode: { sessionId: "s-opencode" } });
        const mock = procs.get("opencode")!;
        const catalog = (modelIds: string[]): BackendState => ({
          model: {
            current: { baseModelId: "opencode/big-pickle", effort: null },
            availableModels: modelIds.map((baseModelId) => ({
              baseModelId,
              name: baseModelId,
              provider: null,
              effortOptions: [],
            })),
            apply: { kind: "setConfigOption", configId: "model" },
          },
          mode: null,
        });
        host.ensureBackendForFanout = async () => ({
          proc: mock.proc,
          descriptor: opencodeEnabling(["provider/enabled"]),
        });
        host.getDefaultSelection = () => ({ baseModelId: "provider/enabled", effort: null });
        jest.mocked(mock.proc.newSession).mockResolvedValue({
          sessionId: "s-opencode",
          state: catalog(["opencode/big-pickle"]),
        });
        mock.endTurnsAtOnce();

        const run = new FanoutOrchestrator(host).run(runInput(["opencode"]));
        await flush();
        expect(mock.proc.setSessionConfigOption).not.toHaveBeenCalled();
        expect(mock.promptCount()).toBe(0);

        mock.emit({
          sessionId: "s-opencode",
          update: {
            sessionUpdate: "state_changed",
            state: catalog(["opencode/big-pickle", "provider/enabled"]),
          },
        });
        const turn = await run;

        expect(turn.answers.opencode.status).toBe("done");
        expect(mock.proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-opencode",
          configId: "model",
          value: "provider/enabled",
        });
        expect(mock.promptCount()).toBe(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 fails an OpenCode slot without prompting when the user enabled no model, rather than running OpenCode's own", async () => {
        const { host, procs } = makeHost({ opencode: { sessionId: "s-opencode" } });
        const mock = procs.get("opencode")!;
        host.ensureBackendForFanout = async () => ({
          proc: mock.proc,
          descriptor: opencodeEnabling([]),
        });
        jest.mocked(mock.proc.newSession).mockResolvedValue({
          sessionId: "s-opencode",
          state: {
            model: {
              current: { baseModelId: "opencode/big-pickle", effort: null },
              availableModels: [
                {
                  baseModelId: "opencode/big-pickle",
                  name: "Big Pickle",
                  provider: null,
                  effortOptions: [],
                },
              ],
              apply: { kind: "setConfigOption", configId: "model" },
            },
            mode: null,
          },
        });

        const turn = await new FanoutOrchestrator(host).run(runInput(["opencode"]));

        expect(turn.answers.opencode).toMatchObject({
          status: "error",
          error: expect.stringContaining("None of the models enabled for"),
        });
        expect(mock.promptCount()).toBe(0);
        expect(mock.proc.setSessionConfigOption).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 keeps Claude's separate effort dispatch when fan-out uses the shared descriptor contract", async () => {
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
        const proc = procs.get("claude")!.proc;
        const modelId = "claude-sonnet-4-5";
        host.ensureBackendForFanout = async () => ({ proc, descriptor: ClaudeBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: modelId, effort: "high" });
        const effortOption = ClaudeBackendDescriptor.wire.effortConfigFor?.(modelId);
        expect(effortOption).toBeTruthy();
        procs.get("claude")!.endTurnsAtOnce();

        await new FanoutOrchestrator(host).run(runInput(["claude"]));

        expect(proc.setSessionModel).toHaveBeenCalledWith({ sessionId: "s-claude", modelId });
        expect(proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-claude",
          configId: effortOption!.id,
          value: "high",
        });
      });
    });
  });
});
