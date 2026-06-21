import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  ModelSelection,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { createFanoutTurn, FanoutOrchestrator, type FanoutHost } from "./FanoutOrchestrator";

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
  cancel: jest.Mock;
  resolvePrompt: () => void;
  rejectPrompt: (err: unknown) => void;
}

/**
 * Mock backend process whose `prompt` stays pending until the test resolves it,
 * so streamed events can land before the turn settles. `sessionId` is fixed per
 * backend so the orchestrator's per-session handler routing is exercised.
 */
function makeMockProc(sessionId: string): MockProc {
  let handler: SessionUpdateHandler | null = null;
  let resolvePrompt!: () => void;
  let rejectPrompt!: (err: unknown) => void;
  const promptPromise = () =>
    new Promise<{ stopReason: "end_turn" }>((resolve, reject) => {
      resolvePrompt = () => resolve({ stopReason: "end_turn" });
      rejectPrompt = reject;
    });
  const setSessionMode = jest.fn(async () => ({ model: null, mode: null }));
  const setSessionModel = jest.fn(async () => ({ model: null, mode: null }));
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
    setSessionConfigOption: jest.fn(async () => ({ model: null, mode: null })),
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
    cancel,
    resolvePrompt: () => resolvePrompt(),
    rejectPrompt: (err) => rejectPrompt(err),
  };
}

function descriptorFor(id: BackendId, planNativeId?: string): BackendDescriptor {
  return {
    id,
    wire: { encode: (s: ModelSelection) => `${s.baseModelId}/${s.effort ?? "default"}` },
    getModeMapping: planNativeId
      ? () => ({ kind: "setMode" as const, canonical: { plan: planNativeId } })
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
  config: Record<BackendId, { sessionId: string; planNativeId?: string }>,
  defaults: Partial<Record<BackendId, ModelSelection>> = {}
): HostHarness {
  const procs = new Map<BackendId, MockProc>();
  const descriptors = new Map<BackendId, BackendDescriptor>();
  for (const [id, { sessionId, planNativeId }] of Object.entries(config)) {
    procs.set(id, makeMockProc(sessionId));
    descriptors.set(id, descriptorFor(id, planNativeId));
  }
  const readOnlyRegistered: string[] = [];
  const readOnlyUnregistered: string[] = [];
  const host: FanoutHost = {
    ensureBackendForFanout: async (backendId) => ({
      proc: procs.get(backendId)!.proc,
      descriptor: descriptors.get(backendId)!,
    }),
    getDefaultSelection: (backendId) => defaults[backendId] ?? null,
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

    const runPromise = orchestrator.run({
      agents: ["claude", "codex"],
      prompt: [{ type: "text", text: "review this" }],
      signal: controller.signal,
      onChange: (turn) => snapshots.push(JSON.stringify(turn.answers)),
    });

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "Claude says hi"));
    procs.get("codex")!.emit(textChunk("s-codex", "Codex says hi"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.resolvePrompt();

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
    // Summary stays pending in Phase 2.
    expect(turn.summary.status).toBe("pending");
    // Each sub-session was registered and then unregistered as read-only.
    expect(readOnlyRegistered.sort()).toEqual(["s-claude", "s-codex"]);
    expect(readOnlyUnregistered.sort()).toEqual(["s-claude", "s-codex"]);
    expect(snapshots.length).toBeGreaterThan(1);
  });

  it("isolates a failed agent as an error slot while others complete", async () => {
    const { host, procs } = makeHost({
      claude: { sessionId: "s-claude" },
      codex: { sessionId: "s-codex" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();

    const runPromise = orchestrator.run({
      agents: ["claude", "codex"],
      prompt: [{ type: "text", text: "q" }],
      signal: controller.signal,
      onChange: () => {},
    });

    await flush();
    procs.get("claude")!.emit(textChunk("s-claude", "ok"));
    procs.get("claude")!.resolvePrompt();
    procs.get("codex")!.rejectPrompt(new Error("backend boom"));

    const turn = await runPromise;
    expect(turn.answers.claude.status).toBe("done");
    expect(turn.answers.codex.status).toBe("error");
    expect(turn.answers.codex.error).toContain("backend boom");
  });

  it("applies the read-only sandbox mode only for backends that map plan→read-only", async () => {
    const { host, procs } = makeHost({
      codex: { sessionId: "s-codex", planNativeId: "read-only" },
      opencode: { sessionId: "s-opencode" },
    });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();

    const runPromise = orchestrator.run({
      agents: ["codex", "opencode"],
      prompt: [{ type: "text", text: "q" }],
      signal: controller.signal,
      onChange: () => {},
    });
    await flush();
    procs.get("codex")!.resolvePrompt();
    procs.get("opencode")!.resolvePrompt();
    await runPromise;

    expect(procs.get("codex")!.setSessionMode).toHaveBeenCalledWith({
      sessionId: "s-codex",
      modeId: "read-only",
    });
    expect(procs.get("opencode")!.setSessionMode).not.toHaveBeenCalled();
  });

  it("switches each sub-session onto the backend's configured default model", async () => {
    const { host, procs } = makeHost(
      { claude: { sessionId: "s-claude" } },
      { claude: { baseModelId: "claude-opus-4-5", effort: "high" } }
    );
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run({
      agents: ["claude"],
      prompt: [{ type: "text", text: "q" }],
      signal: controller.signal,
      onChange: () => {},
    });
    await flush();
    procs.get("claude")!.resolvePrompt();
    await runPromise;

    expect(procs.get("claude")!.setSessionModel).toHaveBeenCalledWith({
      sessionId: "s-claude",
      modelId: "claude-opus-4-5/high",
    });
  });

  it("cancels in-flight sub-session prompts when the signal aborts", async () => {
    const { host, procs } = makeHost({ claude: { sessionId: "s-claude" } });
    const orchestrator = new FanoutOrchestrator(host);
    const controller = new AbortController();
    const runPromise = orchestrator.run({
      agents: ["claude"],
      prompt: [{ type: "text", text: "q" }],
      signal: controller.signal,
      onChange: () => {},
    });
    await flush();
    controller.abort();
    procs.get("claude")!.resolvePrompt();
    await runPromise;
    expect(procs.get("claude")!.cancel).toHaveBeenCalledWith({ sessionId: "s-claude" });
  });
});
