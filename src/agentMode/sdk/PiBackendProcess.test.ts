import type { BackendDescriptor, SessionEvent } from "@/agentMode/session/types";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { PiBackendProcess } from "./PiBackendProcess";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const refresh = jest.fn(async () => ({ aborted: false, errors: new Map() }));
const listeners: Array<(e: AgentEvent) => void> = [];
const engine = {
  prompt: jest.fn(async () => undefined),
  abort: jest.fn(async () => undefined),
  setModel: jest.fn(async (id: string) => {
    engine.modelId = id;
  }),
  getModelId: () => engine.modelId,
  compact: jest.fn(async () => undefined),
  usage: jest.fn(() => ({
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
    contextTokens: 6,
    contextWindow: 1000,
  })),
  modelId: "copilot-plus/copilot-plus-flash",
};

jest.mock("@/pi/engine", () => ({
  // Mirrors the real factory: the engine opens on the model id it is given.
  createPiEngine: jest.fn((options: { modelId: string }) => {
    engine.modelId = options.modelId;
    return {
      ...engine,
      subscribe: (fn: (e: AgentEvent) => void) => {
        listeners.push(fn);
        return () => listeners.splice(listeners.indexOf(fn), 1);
      },
    };
  }),
}));

jest.mock("@/pi/providers", () => ({
  createPiModels: jest.fn(() => ({ refresh })),
  listPiModels: jest.fn(() => [
    {
      id: "copilot-plus-flash",
      wireId: "copilot-plus/copilot-plus-flash",
      providerId: "copilot-plus",
      label: "Flash",
      contextWindow: 1000,
    },
    {
      id: "kimi-k2.6",
      wireId: "copilot-plus/kimi-k2.6",
      providerId: "copilot-plus",
      label: "Kimi",
      contextWindow: 500,
    },
    {
      id: "kimi-k2.6",
      wireId: "local-endpoint/kimi-k2.6",
      providerId: "local-endpoint",
      label: "Kimi (local)",
      contextWindow: 500,
    },
  ]),
}));

const toolContext = {
  readActiveNote: jest.fn(async () => null),
  readNote: jest.fn(async () => null),
  searchVault: jest.fn(async () => []),
  webSearch: jest.fn(async () => ""),
};

const files = new Map<string, string>();
const fileStore = {
  dir: "config/plugins/copilot/pi-sessions",
  read: jest.fn(async (path: string) => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`${path} does not exist`);
    return content;
  }),
  write: jest.fn(async (path: string, content: string) => {
    files.set(path, content);
  }),
  append: jest.fn(async (path: string, content: string) => {
    files.set(path, (files.get(path) ?? "") + content);
  }),
  mkdir: jest.fn(async () => undefined),
  exists: jest.fn(async (path: string) => files.has(path)),
};

const descriptor = {
  id: "pi",
  wire: {
    encode: (s: { baseModelId: string }) => s.baseModelId,
    decode: (wireId: string) => ({
      selection: { baseModelId: wireId, effort: null },
      provider: null,
    }),
  },
} as unknown as BackendDescriptor;

function emit(event: AgentEvent): void {
  for (const listener of [...listeners]) listener(event);
}

describe("PiBackendProcess", () => {
  function createProcess(): PiBackendProcess {
    return new PiBackendProcess({
      descriptor,
      getProviderDeps: async () => ({ plusLicenseKey: "key", byokProviders: [], fetch: jest.fn() }),
      toolContext,
      fileStore,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    listeners.length = 0;
    engine.modelId = "copilot-plus/copilot-plus-flash";
  });

  describe("newSession()", () => {
    it("opens on the persisted model preference when it is still available", async () => {
      const proc = new PiBackendProcess({
        descriptor,
        getProviderDeps: async () => ({
          plusLicenseKey: "key",
          byokProviders: [],
          fetch: jest.fn(),
        }),
        getDefaultModelId: () => "copilot-plus/kimi-k2.6",
        toolContext,
        fileStore,
      });

      const { state } = await proc.newSession({ cwd: "/vault" });

      expect(state.model?.current.baseModelId).toBe("copilot-plus/kimi-k2.6");
    });

    it("falls back to the first catalog model when the preference is gone", async () => {
      const proc = new PiBackendProcess({
        descriptor,
        getProviderDeps: async () => ({
          plusLicenseKey: "key",
          byokProviders: [],
          fetch: jest.fn(),
        }),
        getDefaultModelId: () => "retired-model",
        toolContext,
        fileStore,
      });

      const { state } = await proc.newSession({ cwd: "/vault" });

      expect(state.model?.current.baseModelId).toBe("copilot-plus/copilot-plus-flash");
    });

    it("advertises the whole catalog to the picker", async () => {
      const { state } = await createProcess().newSession({ cwd: "/vault" });

      // The same bare id served by two providers stays two distinct rows.
      expect(state.model?.availableModels.map((m) => m.baseModelId)).toEqual([
        "copilot-plus/copilot-plus-flash",
        "copilot-plus/kimi-k2.6",
        "local-endpoint/kimi-k2.6",
      ]);
    });

    it("builds the provider collection once across sessions", async () => {
      const proc = createProcess();

      await proc.newSession({ cwd: "/vault" });
      await proc.newSession({ cwd: "/vault" });

      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("registerSessionHandler()", () => {
    it("replays events that arrived before the handler registered", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      emit({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi", partial: {} },
      } as unknown as AgentEvent);

      const seen: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (event) => seen.push(event));

      expect(seen).toHaveLength(1);
      expect(seen[0].update).toEqual({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      });
    });
  });

  describe("prompt()", () => {
    it("sends the text blocks and reports the turn ended", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      const result = await proc.prompt({
        sessionId,
        prompt: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      });

      expect(engine.prompt).toHaveBeenCalledWith("hello world", undefined);
      expect(result.stopReason).toBe("end_turn");
    });

    it("forwards image blocks alongside the text", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      await proc.prompt({
        sessionId,
        prompt: [
          { type: "text", text: "look" },
          { type: "image", mimeType: "image/png", data: "AAA" },
        ],
      });

      expect(engine.prompt).toHaveBeenCalledWith("look", [
        { type: "image", data: "AAA", mimeType: "image/png" },
      ]);
    });

    it("rejects for a session that does not exist", async () => {
      await expect(
        createProcess().prompt({ sessionId: "missing", prompt: [{ type: "text", text: "hi" }] })
      ).rejects.toThrow("Unknown session missing");
    });

    it("publishes a usage snapshot when the turn ends", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const seen: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (event) => seen.push(event));

      emit({ type: "turn_end", message: {}, toolResults: [] } as unknown as AgentEvent);

      expect(seen.at(-1)?.update).toMatchObject({
        sessionUpdate: "usage_update",
        usage: { usedTokens: 6, contextWindow: 1000, cacheReadTokens: 3 },
      });
    });
  });

  describe("setSessionModel()", () => {
    it("switches the live session and reports the new selection", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      // The local endpoint serves the same bare id as Copilot Plus, so the
      // selection has to reach that provider rather than the first id match.
      const state = await proc.setSessionModel({
        sessionId,
        modelId: "local-endpoint/kimi-k2.6",
      });

      expect(engine.setModel).toHaveBeenCalledWith("local-endpoint/kimi-k2.6");
      expect(state.model?.current.baseModelId).toBe("local-endpoint/kimi-k2.6");
    });
  });

  describe("cancel()", () => {
    it("aborts the running turn", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      await proc.cancel({ sessionId });

      expect(engine.abort).toHaveBeenCalled();
    });

    it("ignores an unknown session rather than throwing mid-teardown", async () => {
      await expect(createProcess().cancel({ sessionId: "missing" })).resolves.toBeUndefined();
    });

    it("reports a stopped turn as cancelled, not as a completed one", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      engine.prompt.mockImplementationOnce(async () => {
        await proc.cancel({ sessionId });
      });

      const result = await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

      expect(result.stopReason).toBe("cancelled");
    });

    it("swallows the abort rejection but still surfaces a real turn failure", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      engine.prompt.mockImplementationOnce(async () => {
        await proc.cancel({ sessionId });
        throw new Error("aborted");
      });

      await expect(
        proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] })
      ).resolves.toEqual({ stopReason: "cancelled" });

      engine.prompt.mockImplementationOnce(() => Promise.reject(new Error("provider exploded")));
      await expect(
        proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] })
      ).rejects.toThrow("provider exploded");
    });
  });

  describe("capability probes", () => {
    it("supports model switching but not modes, config options, or MCP", () => {
      const proc = createProcess();

      expect(proc.isSetSessionModelSupported()).toBe(true);
      expect(proc.isSetSessionModeSupported()).toBe(false);
      expect(proc.isSetSessionConfigOptionSupported()).toBe(false);
      expect(proc.supportsMcpTransport()).toBe(false);
    });

    it("rejects the unsupported session calls", async () => {
      const proc = createProcess();

      await expect(proc.setSessionMode()).rejects.toThrow();
      await expect(proc.setSessionConfigOption()).rejects.toThrow();
    });

    it("enumerates no sessions — transcripts are addressed by id", async () => {
      await expect(createProcess().listSessions({})).resolves.toEqual({ sessions: [] });
    });
  });

  describe("resumeSession()", () => {
    it("reopens the stored transcript so the model keeps its history", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      await proc.shutdown();

      const resumed = createProcess();
      const output = await resumed.resumeSession({ sessionId, cwd: "/vault" });

      expect(output.sessionId).toBe(sessionId);
      expect(output.state.model?.current.baseModelId).toBe("copilot-plus/copilot-plus-flash");
    });

    it("streams into the resumed session", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      await proc.shutdown();
      const resumed = createProcess();
      await resumed.resumeSession({ sessionId, cwd: "/vault" });
      const seen: SessionEvent[] = [];
      resumed.registerSessionHandler(sessionId, (event) => seen.push(event));

      emit({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "back", partial: {} },
      } as unknown as AgentEvent);

      expect(seen.at(-1)?.update).toMatchObject({ sessionUpdate: "agent_message_chunk" });
    });

    it("fails loudly when the transcript is not on this device", async () => {
      await expect(
        createProcess().resumeSession({ sessionId: "never-here", cwd: "/vault" })
      ).rejects.toThrow();
    });

    it("reports whether a transcript exists locally, so dead rows can be hidden", async () => {
      const proc = createProcess();
      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      await expect(proc.sessionExistsLocally({ sessionId })).resolves.toBe(true);
      await expect(proc.sessionExistsLocally({ sessionId: "other" })).resolves.toBe(false);
    });
  });

  describe("shutdown()", () => {
    it("aborts live sessions, notifies exit listeners, and stops running", async () => {
      const proc = createProcess();
      await proc.newSession({ cwd: "/vault" });
      const onExit = jest.fn();
      proc.onExit(onExit);

      await proc.shutdown();

      expect(engine.abort).toHaveBeenCalled();
      expect(onExit).toHaveBeenCalled();
      expect(proc.isRunning()).toBe(false);
    });
  });
});
