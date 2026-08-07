import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
import { translateBackendState } from "@/agentMode/session/translateBackendState";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  ModelSelection,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { createFanoutTurn, FanoutOrchestrator, type FanoutHost } from "./FanoutOrchestrator";
import { FANOUT_ALL_FAILED_SUMMARY, FANOUT_TRAILING_CHUNK_GRACE_MS } from "./fanoutTypes";

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
  const emptyState = (): BackendState => ({ model: null, mode: null });
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
    newSession: jest.fn(() => Promise.resolve({ sessionId, state: emptyState() })),
    prompt: jest.fn(() => promptPromise()),
    cancel,
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
    resolvePrompt: () => settleOldest((p) => p.resolve()),
    rejectPrompt: (err) => settleOldest((p) => p.reject(err)),
    promptCount: () => (proc.prompt as jest.Mock).mock.calls.length,
  };
}

function descriptorFor(id: BackendId, readOnlyModeId?: string): BackendDescriptor {
  return {
    id,
    wire: { encode: (s: ModelSelection) => `${s.baseModelId}/${s.effort ?? "default"}` },
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
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies a model-only Codex default through the same advertised option for answer and summary sessions", async () => {
        const { host, procs } = makeHost({ codex: { sessionId: "s-codex" } });
        const proc = procs.get("codex")!.proc;
        const state = translateBackendState(
          {
            models: {
              currentModelId: "example[high]",
              availableModels: ["low", "high"].map((effort) => ({
                modelId: `example[${effort}]`,
                name: "Example",
              })),
            },
            modes: null,
            configOptions: [
              {
                id: "model-choice",
                category: "model",
                type: "select",
                name: "Model",
                currentValue: "example",
                options: [{ value: "example", name: "Example" }],
              },
            ],
          },
          CodexBackendDescriptor
        );
        jest.mocked(proc.newSession).mockResolvedValue({ sessionId: "s-codex", state });
        jest.mocked(proc.setSessionConfigOption).mockResolvedValue(state);
        jest.mocked(proc.prompt).mockImplementation(async () => {
          procs.get("codex")!.emit(textChunk("s-codex", "answer"));
          return { stopReason: "end_turn" };
        });
        host.ensureBackendForFanout = async () => ({ proc, descriptor: CodexBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: null });

        await new FanoutOrchestrator(host).run(runInput(["codex"]));

        expect(proc.setSessionModel).not.toHaveBeenCalled();
        expect(proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-codex",
          configId: "model-choice",
          value: "example",
        });
        expect(proc.setSessionConfigOption).toHaveBeenCalledTimes(2);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 sends an explicit Codex effort through the descriptor's wire format", async () => {
        const { host, procs } = makeHost({ codex: { sessionId: "s-codex" } });
        const proc = procs.get("codex")!.proc;
        host.ensureBackendForFanout = async () => ({ proc, descriptor: CodexBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: "high" });
        jest.mocked(proc.prompt).mockResolvedValue({ stopReason: "end_turn" });
        await new FanoutOrchestrator(host).run(runInput(["codex"]));
        expect(proc.setSessionModel).toHaveBeenCalledWith({
          sessionId: "s-codex",
          modelId: "example[high]",
        });
        expect(proc.setSessionConfigOption).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 reports an unsupported model-only switch rather than running fan-out on a different model", async () => {
        const { host, procs } = makeHost({ codex: { sessionId: "s-codex" } });
        const proc = procs.get("codex")!.proc;
        host.ensureBackendForFanout = async () => ({ proc, descriptor: CodexBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: null });
        const result = await new FanoutOrchestrator(host).run(runInput(["codex"]));
        expect(result.answers.codex.status).toBe("error");
        expect(result.answers.codex.error).toContain("Choose an explicit effort");
        expect(proc.prompt).not.toHaveBeenCalled();
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
              availableModels: [],
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
            descriptor: OpencodeBackendDescriptor,
          });
          host.getDefaultSelection = () => ({ baseModelId: "provider/new", effort: "high" });
          jest
            .mocked(proc.newSession)
            .mockResolvedValue({ sessionId: "s-opencode", state: initial });
          jest.mocked(proc.setSessionConfigOption).mockResolvedValue(refreshed);
          jest.mocked(proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

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

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 keeps Claude's separate effort dispatch when fan-out uses the shared descriptor contract", async () => {
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
        const proc = procs.get("claude")!.proc;
        const modelId = "claude-sonnet-4-5";
        host.ensureBackendForFanout = async () => ({ proc, descriptor: ClaudeBackendDescriptor });
        host.getDefaultSelection = () => ({ baseModelId: modelId, effort: "high" });
        // The real descriptor uses its SDK catalog's effort option.
        const effortOption = ClaudeBackendDescriptor.wire.effortConfigFor?.(modelId);
        expect(effortOption).toBeTruthy();
        jest.mocked(proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

        await new FanoutOrchestrator(host).run(runInput(["claude"]));

        expect(proc.setSessionModel).toHaveBeenCalledWith({ sessionId: "s-claude", modelId });
        expect(proc.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "s-claude",
          configId: effortOption!.id,
          value: "high",
        });
      });

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
        // Every sub-session (incl. the summary's) is tombstoned so it never leaks
        // into Recent Chats as a phantom native session.
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
        // The failed agent is never fed as an answer AND never named to the
        // summarizer, so the summary can't mention or speculate about it.
        const summaryCall = (procs.get("claude")!.proc.prompt as jest.Mock).mock.calls[1][0];
        const text = summaryCall.prompt[0].text as string;
        expect(text).toContain("the original question");
        expect(text).toContain("CLAUDE");
        expect(text).not.toContain("CODEX");
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
    });
  });
});
