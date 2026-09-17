import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import { CodexBackendDescriptor } from "@/agentMode/backends/codex/descriptor";
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
import {
  FANOUT_ALL_FAILED_SUMMARY,
  FANOUT_MISSING_AGENT_ERROR,
  FANOUT_TRAILING_CHUNK_GRACE_MS,
  type FanoutAnswerer,
} from "./fanoutTypes";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("./fanoutTypes", () => ({
  ...jest.requireActual("./fanoutTypes"),
  FANOUT_TRAILING_CHUNK_GRACE_MS: 5,
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
    ensureBackendForSubSession: async (backendId) => ({
      proc: procs.get(backendId)!.proc,
      descriptor: descriptors.get(backendId)!,
    }),
    getDefaultSelection: () => null,
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

const flushPastGrace = () =>
  new Promise((r) => window.setTimeout(r, FANOUT_TRAILING_CHUNK_GRACE_MS + 20));

function answerer(backendId: BackendId, overrides: Partial<FanoutAnswerer> = {}): FanoutAnswerer {
  return {
    slug: backendId,
    name: backendId.toUpperCase(),
    icon: "",
    backendId,
    personaBlock: null,
    memoryEnabled: false,
    ...overrides,
  };
}

function runInput(
  agents: BackendId[],
  overrides: Partial<Parameters<FanoutOrchestrator["run"]>[0]> = {}
): Parameters<FanoutOrchestrator["run"]>[0] {
  return {
    answerers: agents.map((id) => answerer(id)),
    sessionBackendId: agents[0],
    summarizerPersonaBlock: null,
    prompt: [{ type: "text", text: "q" }],
    originalPromptText: "the original question",
    signal: new AbortController().signal,
    onChange: () => {},
    ...overrides,
  };
}

describe("FanoutOrchestrator", () => {
  describe("createFanoutTurn()", () => {
    it("seeds one running slot per agent (mention order), labeled with its name and icon", () => {
      const turn = createFanoutTurn([
        answerer("opencode"),
        answerer("claude", { slug: "jennifer", name: "Jennifer", icon: "🪶" }),
        answerer("codex"),
      ]);
      expect(Object.keys(turn.answers)).toEqual(["opencode", "jennifer", "codex"]);
      expect(turn.answers.jennifer).toEqual({
        agentSlug: "jennifer",
        name: "Jennifer",
        icon: "🪶",
        status: "running",
        text: "",
      });
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

        await flush();
        procs.get("claude")!.emit(textChunk("s-claude", "Claude says hi"));
        procs.get("codex")!.emit(textChunk("s-codex", "Codex says hi"));
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.resolvePrompt();
        await flushPastGrace();
        procs.get("claude")!.emit(textChunk("s-claude", "summary"));
        procs.get("claude")!.resolvePrompt();

        const turn = await runPromise;
        expect(turn.answers.claude).toMatchObject({ status: "done", text: "Claude says hi" });
        expect(turn.answers.codex).toMatchObject({ status: "done", text: "Codex says hi" });
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

        await flush();
        procs.get("claude")!.emit(textChunk("s-claude", "ok"));
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.rejectPrompt(new Error("backend boom"));
        await flushPastGrace();
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
        await flush();
        procs.get("codex")!.resolvePrompt();
        procs.get("opencode")!.resolvePrompt();
        await flushPastGrace();
        procs.get("codex")!.resolvePrompt();
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
        controller.abort();
        procs.get("claude")!.resolvePrompt();
        procs.get("codex")!.resolvePrompt();
        const turn = await runPromise;

        expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
        expect(procs.get("codex")!.cancel).toHaveBeenCalledWith({ sessionId: "s-codex" });
        expect(turn.answers.claude.status).toBe("cancelled");
        expect(turn.answers.codex.status).toBe("cancelled");
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
        expect(procs.get("claude")!.promptCount()).toBe(1);
        expect(procs.get("codex")!.promptCount()).toBe(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/481 returns one mentioned agent's answer without dispatching a summary", async () => {
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          opencode: { sessionId: "s-opencode" },
        });
        const proc = procs.get("claude")!;
        jest.mocked(proc.proc.prompt).mockImplementation(async () => {
          proc.emit(textChunk("s-claude", "Claude answered directly"));
          return { stopReason: "end_turn" };
        });

        const turn = await new FanoutOrchestrator(host).run(
          runInput(["claude"], { sessionBackendId: "opencode" })
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
        host.ensureBackendForSubSession = async (backendId) =>
          backendId === "codex"
            ? { proc, descriptor: CodexBackendDescriptor }
            : {
                proc: procs.get(backendId)!.proc,
                descriptor: descriptorFor(backendId),
              };
        host.getDefaultSelection = () => ({ baseModelId: "example", effort: "high" });
        jest.mocked(proc.prompt).mockImplementation(async () => {
          procs.get("codex")!.emit(textChunk("s-codex", "answer"));
          return { stopReason: "end_turn" };
        });
        jest.mocked(procs.get("claude")!.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });
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
        host.ensureBackendForSubSession = async () => ({
          proc,
          descriptor: CodexBackendDescriptor,
        });
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
        host.ensureBackendForSubSession = async (backendId) =>
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
        jest.mocked(proc.prompt).mockImplementation(async () => {
          procs.get("codex")!.emit(textChunk("s-codex", "Successful answer"));
          return { stopReason: "end_turn" };
        });
        jest.mocked(procs.get("claude")!.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

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
        host.ensureBackendForSubSession = async (backendId) =>
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
        jest.mocked(proc.prompt).mockImplementation(async () => {
          procs.get("opencode")!.emit(textChunk("s-opencode", "answer"));
          return { stopReason: "end_turn" };
        });
        jest.mocked(procs.get("claude")!.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

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
          host.ensureBackendForSubSession = async () => ({
            proc,
            descriptor: opencodeEnabling(["provider/new"]),
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
        host.ensureBackendForSubSession = async () => ({
          proc: mock.proc,
          descriptor: opencodeEnabling(["provider/enabled"]),
        });
        host.getDefaultSelection = () => ({ baseModelId: "provider/enabled", effort: null });
        jest.mocked(mock.proc.newSession).mockResolvedValue({
          sessionId: "s-opencode",
          state: catalog(["opencode/big-pickle"]),
        });
        jest.mocked(mock.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

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
        host.ensureBackendForSubSession = async () => ({
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
        host.ensureBackendForSubSession = async () => ({
          proc,
          descriptor: ClaudeBackendDescriptor,
        });
        host.getDefaultSelection = () => ({ baseModelId: modelId, effort: "high" });
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

      it("leads each answerer's prompt with its own persona and memory, on the backend it pinned", async () => {
        // designdocs/CUSTOM_AGENTS.md §6 — an agent answers in character, and an
        // agent that pins no backend answers on the chat's own.
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          codex: { sessionId: "s-codex" },
        });
        jest.mocked(procs.get("claude")!.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });
        jest.mocked(procs.get("codex")!.proc.prompt).mockResolvedValue({ stopReason: "end_turn" });

        await new FanoutOrchestrator(host).run(
          runInput([], {
            sessionBackendId: "claude",
            answerers: [
              answerer("codex", {
                slug: "jennifer",
                name: "Jennifer",
                personaBlock: "<agent_persona>Jennifer</agent_persona>",
              }),
              answerer("claude", {
                slug: "vancat",
                name: "Vancat",
                backendId: null,
                personaBlock: "<agent_persona>Vancat</agent_persona>",
              }),
            ],
          })
        );

        const jenniferPrompt = jest.mocked(procs.get("codex")!.proc.prompt).mock.calls[0][0];
        expect((jenniferPrompt.prompt[0] as { text: string }).text).toBe(
          "<agent_persona>Jennifer</agent_persona>\n\nq"
        );
        // Vancat pins nothing, so it answers on the chat's backend — which is
        // also where the summary later runs.
        const vancatPrompt = jest.mocked(procs.get("claude")!.proc.prompt).mock.calls[0][0];
        expect((vancatPrompt.prompt[0] as { text: string }).text).toBe(
          "<agent_persona>Vancat</agent_persona>\n\nq"
        );
      });

      it("has the chat's own persona write the summary, in its own voice", async () => {
        // designdocs/CUSTOM_AGENTS.md §6 — a DM with Jennifer that fans out to
        // Vancat is summarized by Jennifer, not by the anonymous assistant.
        const { host, procs } = makeHost({
          claude: { sessionId: "s-claude" },
          codex: { sessionId: "s-codex" },
        });
        for (const id of ["claude", "codex"]) {
          jest.mocked(procs.get(id)!.proc.prompt).mockImplementation(async () => {
            procs.get(id)!.emit(textChunk(`s-${id}`, `${id} answer`));
            return { stopReason: "end_turn" };
          });
        }

        await new FanoutOrchestrator(host).run(
          runInput(["claude", "codex"], {
            summarizerPersonaBlock: "<agent_persona>Jennifer</agent_persona>",
          })
        );

        const summaryPrompt = jest.mocked(procs.get("claude")!.proc.prompt).mock.calls[1][0];
        const text = (summaryPrompt.prompt[0] as { text: string }).text;
        expect(text.startsWith("<agent_persona>Jennifer</agent_persona>\n\n")).toBe(true);
        expect(text).toContain("the original question");
      });

      it("reports an agent deleted between composing and sending instead of answering as nobody", async () => {
        // designdocs/CUSTOM_AGENTS.md §1 — a chat outlives the agent it names.
        const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });

        const turn = await new FanoutOrchestrator(host).run(
          runInput([], {
            sessionBackendId: "claude",
            answerers: [answerer("claude", { slug: "ghost", name: "Ghost", missing: true })],
          })
        );

        expect(turn.answers.ghost).toMatchObject({
          status: "error",
          error: FANOUT_MISSING_AGENT_ERROR,
        });
        expect(procs.get("claude")!.proc.newSession).not.toHaveBeenCalled();
      });
    });
  });
});
