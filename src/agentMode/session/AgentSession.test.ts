import { AI_SENDER, USER_SENDER } from "@/constants";
import type { TFile } from "obsidian";
import { AgentSession, buildPromptBlocks, tryReadExitPlanModeCall } from "./AgentSession";
import { MethodUnsupportedError } from "./errors";
import type {
  BackendDescriptor,
  BackendProcess,
  BackendState,
  SessionEvent,
  SessionUpdateHandler,
} from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: { mcpServers: [] } }),
}));

interface MockBackend {
  asBackend: BackendProcess;
  registerHandler: jest.Mock;
  emit: (event: SessionEvent) => void;
  prompt: jest.Mock;
  cancel: jest.Mock;
  newSession: jest.Mock;
  setSessionModel: jest.Mock;
  setSessionConfigOption: jest.Mock;
  setSessionMode: jest.Mock;
  listSessions: jest.Mock;
}

function emptyState(): BackendState {
  return { model: null, mode: null };
}

function makeMockBackend(): MockBackend {
  let handler: SessionUpdateHandler | null = null;
  const registerHandler = jest.fn((_id: string, h: SessionUpdateHandler) => {
    handler = h;
    return () => {
      handler = null;
    };
  });
  const prompt = jest.fn(async () => ({ stopReason: "end_turn" as const }));
  const cancel = jest.fn(async () => undefined);
  const newSession = jest.fn(async () => ({ sessionId: "acp-1", state: emptyState() }));
  const setSessionModel = jest.fn(async () => emptyState());
  const setSessionConfigOption = jest.fn(async () => emptyState());
  const setSessionMode = jest.fn(async () => emptyState());
  const listSessions = jest.fn(async () => ({ sessions: [] }));
  const backend: BackendProcess = {
    isRunning: () => true,
    onExit: () => () => {},
    setPermissionPrompter: () => {},
    registerSessionHandler: registerHandler,
    newSession: newSession,
    prompt: prompt,
    cancel: cancel,
    setSessionModel: setSessionModel,
    isSetSessionModelSupported: () => true,
    setSessionMode: setSessionMode,
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: setSessionConfigOption,
    isSetSessionConfigOptionSupported: () => true,
    listSessions: listSessions,
    resumeSession: () => Promise.reject(new MethodUnsupportedError("resume")),
    loadSession: () => Promise.reject(new MethodUnsupportedError("load")),
    supportsMcpTransport: () => false,
    shutdown: async () => {},
  };
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    setSessionConfigOption,
    setSessionMode,
    listSessions,
    emit: (event) => handler?.(event),
  };
}

describe("buildPromptBlocks", () => {
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  const makeFile = (path: string) => ({ path }) as unknown as TFile;

  it("returns plain text when no context is attached", () => {
    expect(buildPromptBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns plain text when context has no notes or excerpts", () => {
    const blocks = buildPromptBlocks("hello", { notes: [], urls: [] });
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("wraps the message with note paths when contextNotes are attached", () => {
    const blocks = buildPromptBlocks("summarize them", {
      notes: [makeFile("daily/2026-04-28.md"), makeFile("projects/copilot.md")],
      urls: [],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    const text = (blocks[0] as { type: "text"; text: string }).text;
    expect(text).toContain("<copilot-context>");
    expect(text).toContain("- daily/2026-04-28.md");
    expect(text).toContain("- projects/copilot.md");
    expect(text).toContain("</copilot-context>");
    expect(text).toContain("<user-message>\nsummarize them\n</user-message>");
  });

  it("inlines selected text excerpts with path and line range", () => {
    const blocks = buildPromptBlocks("explain", {
      notes: [],
      urls: [],
      selectedTextContexts: [
        {
          id: "s1",
          sourceType: "note",
          notePath: "projects/copilot.md",
          noteTitle: "copilot",
          startLine: 12,
          endLine: 18,
          content: "line one\nline two",
        },
      ],
    });
    const text = (blocks[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Selected excerpts");
    expect(text).toContain("- projects/copilot.md (lines 12-18):");
    expect(text).toContain("  line one");
    expect(text).toContain("  line two");
  });

  it("ignores web-source selected text excerpts", () => {
    const blocks = buildPromptBlocks("explain", {
      notes: [],
      urls: [],
      selectedTextContexts: [
        {
          id: "w1",
          sourceType: "web",
          title: "Example",
          url: "https://example.com",
          content: "web snippet",
        },
      ],
    });
    expect(blocks).toEqual([{ type: "text", text: "explain" }]);
  });
});

describe("AgentSession.sendPrompt", () => {
  it("appends user + placeholder synchronously and resolves on stopReason", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { userMessageId, turn } = session.sendPrompt("Hi there");

    const messages = session.store.getDisplayMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: userMessageId,
      sender: USER_SENDER,
      message: "Hi there",
    });
    expect(messages[1]).toMatchObject({ sender: AI_SENDER, message: "" });
    expect(session.getStatus()).toBe("running");

    const stopReason = await turn;
    expect(stopReason).toBe("end_turn");
    expect(session.getStatus()).toBe("idle");
    expect(mock.prompt).toHaveBeenCalledWith({
      sessionId: "acp-1",
      prompt: [{ type: "text", text: "Hi there" }],
    });
  });

  it("rejects if a turn is already in flight", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.sendPrompt("first");
    expect(() => session.sendPrompt("second")).toThrow(/in flight/);
  });

  it("marks an empty completed turn as a visible error message", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    await session.sendPrompt("hi").turn;

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toMatch(/without returning any assistant text or tool activity/);
  });

  it("includes nested provider errors when a prompt rejects", async () => {
    const mock = makeMockBackend();
    const error = new Error("stream error");
    (error as { cause?: unknown }).cause = {
      data: {
        error: {
          type: "FreeUsageLimitError",
          message: "Rate limit exceeded. Please try again later.",
        },
      },
    };
    mock.prompt.mockRejectedValueOnce(error);
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });

    await expect(session.sendPrompt("hi").turn).rejects.toThrow("stream error");

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.isErrorMessage).toBe(true);
    expect(placeholder?.message).toContain("FreeUsageLimitError");
    expect(placeholder?.message).toContain("Rate limit exceeded");
  });

  it("agent_message_chunk is appended to placeholder displayText", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    });
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: ", world." },
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.message).toBe("Hello, world.");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("tool_call followed by tool_call_update merges into a single part", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "Read README",
        kind: "read",
        status: "pending",
        rawInput: { path: "README.md" },
      },
    });
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "file contents" } }],
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.parts).toHaveLength(1);
    expect(placeholder?.parts?.[0]).toMatchObject({
      kind: "tool_call",
      id: "tc1",
      title: "Read README",
      status: "completed",
      output: [{ type: "text", text: "file contents" }],
    });

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("truncates large text tool outputs before storing them in UI state", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "codex",
    });
    const { turn } = session.sendPrompt("hi");
    const hugeOutput = "x".repeat(20_000);

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: hugeOutput } }],
      },
    });

    const placeholder = session.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    const part = placeholder?.parts?.[0];
    expect(part).toMatchObject({ kind: "tool_call", id: "tc1" });
    if (part?.kind !== "tool_call") throw new Error("expected tool_call part");
    const output = part.output?.[0];
    expect(output).toMatchObject({
      type: "text",
      truncated: true,
      originalLength: hugeOutput.length,
      omittedLength: 8_000,
    });
    expect(output?.type === "text" ? output.text.length : 0).toBeLessThan(13_000);
    expect(output?.type === "text" ? output.text : "").toContain(
      "Tool output truncated in Copilot UI"
    );

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("cancel() sends cancel and aborts local controller", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "cancelled" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const { turn } = session.sendPrompt("hi");
    await session.cancel();
    expect(mock.cancel).toHaveBeenCalledWith({ sessionId: "acp-1" });
    resolvePrompt!({ stopReason: "cancelled" });
    expect(await turn).toBe("cancelled");
  });
});

describe("AgentSession.create (via start)", () => {
  it("captures `state.model` from newSession and exposes via getState", async () => {
    const mock = makeMockBackend();
    const stateWithModel: BackendState = {
      model: {
        current: { baseModelId: "anthropic/sonnet", effort: null },
        availableModels: [
          {
            baseModelId: "anthropic/sonnet",
            name: "Claude Sonnet",
            provider: "anthropic",
            effortOptions: [],
          },
          { baseModelId: "openai/gpt-5", name: "GPT-5", provider: "openai", effortOptions: [] },
        ],
      },
      mode: null,
    };
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: stateWithModel });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.ready;
    expect(session.getState()?.model?.current.baseModelId).toBe("anthropic/sonnet");
    expect(session.getState()?.model?.availableModels).toHaveLength(2);
  });

  it("getState returns null-model when the agent doesn't report models", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: emptyState() });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.ready;
    expect(session.getState()?.model).toBeNull();
  });

  it("attempts setModel when defaultModelId is set", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: emptyState() });
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelId: "openai/gpt-5",
    });
    await session.ready;
    expect(mock.setSessionModel).toHaveBeenCalledWith({
      sessionId: "acp-1",
      modelId: "openai/gpt-5",
    });
  });

  it("survives a MethodUnsupportedError from default-model application", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", state: emptyState() });
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = AgentSession.start({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      defaultModelId: "openai/gpt-5",
    });
    await session.ready;
    expect(session.getStatus()).toBe("idle");
  });
});

describe("AgentSession.setModel", () => {
  it("calls backend.setSessionModel and replaces the cached state on success", async () => {
    const mock = makeMockBackend();
    const newState: BackendState = {
      model: {
        current: { baseModelId: "x/y", effort: null },
        availableModels: [{ baseModelId: "x/y", name: "X Y", provider: null, effortOptions: [] }],
      },
      mode: null,
    };
    mock.setSessionModel.mockResolvedValueOnce(newState);
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.setModel("x/y");
    expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "x/y" });
    expect(session.getState()?.model?.current.baseModelId).toBe("x/y");
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await expect(session.setModel("x/y")).rejects.toBeInstanceOf(MethodUnsupportedError);
    expect(session.getState()).toBeNull();
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setModel("x/y");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession.setConfigOption", () => {
  it("forwards to backend and replaces state from response", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockResolvedValueOnce(emptyState());
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    await session.setConfigOption("effort", "high");
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "effort",
      value: "high",
    });
  });

  it("notifies onModelChanged subscribers on success", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setConfigOption("effort", "low");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });

  it("rethrows MethodUnsupportedError without notifying", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockRejectedValueOnce(
      new MethodUnsupportedError("session/set_config_option")
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await expect(session.setConfigOption("effort", "high")).rejects.toBeInstanceOf(
      MethodUnsupportedError
    );
    expect(onModelChanged).not.toHaveBeenCalled();
  });
});

describe("AgentSession.setMode", () => {
  it("calls backend.setSessionMode and replaces state on success", async () => {
    const mock = makeMockBackend();
    mock.setSessionMode.mockResolvedValueOnce(emptyState());
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    await session.setMode("plan");
    expect(mock.setSessionMode).toHaveBeenCalledWith({ sessionId: "acp-1", modeId: "plan" });
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionMode.mockRejectedValueOnce(new MethodUnsupportedError("session/set_mode"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    await expect(session.setMode("plan")).rejects.toBeInstanceOf(MethodUnsupportedError);
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    await session.setMode("plan");
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession state_changed event", () => {
  it("swaps cached state and notifies onModelChanged", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const onModelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onModelChanged,
    });
    const newState: BackendState = {
      model: null,
      mode: { current: "plan", options: [{ value: "plan", label: "Plan" }], apply: {} },
    };
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "state_changed", state: newState },
    });
    expect(session.getState()).toBe(newState);
    expect(onModelChanged).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSession intent capabilities", () => {
  function makeDescriptor(opts: {
    descriptorStyleEffort?: boolean;
  }): () => BackendDescriptor | undefined {
    const descriptor = {
      id: "test-backend",
      displayName: "Test",
      wire: {
        encode: () => "",
        decode: () => ({ selection: { baseModelId: "", effort: null }, provider: null }),
        ...(opts.descriptorStyleEffort
          ? {
              effortConfigFor: () => ({
                id: "reasoning_effort",
                label: "Effort",
                values: [],
              }),
            }
          : {}),
      },
    } as unknown as BackendDescriptor;
    return () => descriptor;
  }

  function sessionWith(opts: {
    isModelSwitchSupported: boolean | null;
    isSetSessionConfigOptionSupported: boolean | null;
    isSetModeSupported: boolean | null;
    descriptorStyleEffort?: boolean;
    initialState?: BackendState;
  }): AgentSession {
    const mock = makeMockBackend();
    mock.asBackend.isSetSessionModelSupported = () => opts.isModelSwitchSupported;
    mock.asBackend.isSetSessionConfigOptionSupported = () => opts.isSetSessionConfigOptionSupported;
    mock.asBackend.isSetSessionModeSupported = () => opts.isSetModeSupported;
    return new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "test-backend",
      initialState: opts.initialState ?? null,
      getDescriptor: makeDescriptor({ descriptorStyleEffort: opts.descriptorStyleEffort }),
    });
  }

  it("canSwitchModel mirrors the underlying model-switch probe", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: true,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: false,
      }).canSwitchModel()
    ).toBe(true);
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchModel()
    ).toBe(false);
    expect(
      sessionWith({
        isModelSwitchSupported: null,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchModel()
    ).toBeNull();
  });

  it("canSwitchEffort returns the setConfigOption probe for descriptor-style backends", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: false,
        descriptorStyleEffort: true,
      }).canSwitchEffort()
    ).toBe(true);
  });

  it("canSwitchEffort returns the model-switch probe for suffix-style backends", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: true,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: false,
        descriptorStyleEffort: false,
      }).canSwitchEffort()
    ).toBe(true);
  });

  it("canSwitchMode returns null when no mode state is reported", () => {
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: true,
      }).canSwitchMode()
    ).toBeNull();
  });

  it("canSwitchMode samples the first option's apply spec — setConfigOption", () => {
    const state: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setConfigOption", configId: "mode", value: "plan" } },
      },
    };
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: true,
        isSetModeSupported: false,
        initialState: state,
      }).canSwitchMode()
    ).toBe(true);
  });

  it("canSwitchMode samples the first option's apply spec — setMode", () => {
    const state: BackendState = {
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setMode", nativeId: "plan" } },
      },
    };
    expect(
      sessionWith({
        isModelSwitchSupported: false,
        isSetSessionConfigOptionSupported: false,
        isSetModeSupported: true,
        initialState: state,
      }).canSwitchMode()
    ).toBe(true);
  });
});

describe("AgentSession.setLabel", () => {
  it("stores trimmed label and notifies onLabelChanged", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onLabelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onLabelChanged,
    });

    session.setLabel("  My session  ");
    expect(session.getLabel()).toBe("My session");
    expect(onLabelChanged).toHaveBeenCalledTimes(1);

    session.setLabel("   ");
    expect(session.getLabel()).toBeNull();
    expect(onLabelChanged).toHaveBeenCalledTimes(2);

    session.setLabel(null);
    expect(onLabelChanged).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSession needsAttention flag", () => {
  it("starts cleared and flips on mark / clear with one notification each", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onNeedsAttentionChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onNeedsAttentionChanged,
    });

    expect(session.getNeedsAttention()).toBe(false);

    session.markNeedsAttention();
    expect(session.getNeedsAttention()).toBe(true);
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);
    expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(true);

    // No-op: already true.
    session.markNeedsAttention();
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(1);

    session.clearNeedsAttention();
    expect(session.getNeedsAttention()).toBe(false);
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
    expect(onNeedsAttentionChanged).toHaveBeenLastCalledWith(false);

    // No-op: already false.
    session.clearNeedsAttention();
    expect(onNeedsAttentionChanged).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSession session_info_update", () => {
  it("adopts the title pushed by the agent and notifies listeners", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    const onLabelChanged = jest.fn();
    session.subscribe({
      onMessagesChanged: jest.fn(),
      onStatusChanged: jest.fn(),
      onLabelChanged,
    });

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Refactor auth" },
    });

    expect(session.getLabel()).toBe("Refactor auth");
    expect(onLabelChanged).toHaveBeenCalledTimes(1);
  });

  it("ignores agent-pushed titles after the user has renamed the session", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.setLabel("My label");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Agent-chosen title" },
    });

    expect(session.getLabel()).toBe("My label");
  });

  it("does not require an active turn placeholder", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Idle title" },
    });
    expect(session.getLabel()).toBe("Idle title");
  });

  it("a null/empty agent title clears the label and re-opens it for future agent updates", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "First" },
    });
    expect(session.getLabel()).toBe("First");

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: null },
    });
    expect(session.getLabel()).toBeNull();

    mock.emit({
      sessionId: "acp-1",
      update: { sessionUpdate: "session_info_update", title: "Second" },
    });
    expect(session.getLabel()).toBe("Second");
  });
});

describe("AgentSession title poll after turn", () => {
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("pulls the title via listSessions and applies it after end_turn", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [
        { sessionId: "acp-1", cwd: "/vault", title: "Refactor auth", updatedAt: null },
        { sessionId: "acp-other", cwd: "/vault", title: "Different session", updatedAt: null },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    const { turn } = session.sendPrompt("hi");
    await turn;
    await flushMicrotasks();

    expect(mock.listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    expect(session.getLabel()).toBe("Refactor auth");
  });

  it("ignores opencode's default 'New session - …' placeholder titles", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [
        {
          sessionId: "acp-1",
          cwd: "/vault",
          title: "New session - 2026-04-26T01:24:54.221Z",
          updatedAt: null,
        },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(session.getLabel()).toBeNull();
  });

  it("does not poll when the user has already renamed the session", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    session.setLabel("My label");
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
    expect(session.getLabel()).toBe("My label");
  });

  it("does not poll on cancelled turns", async () => {
    const mock = makeMockBackend();
    mock.prompt.mockResolvedValueOnce({ stopReason: "cancelled" });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
  });

  it("silently no-ops when the agent doesn't support listSessions", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockRejectedValueOnce(new MethodUnsupportedError("session/list"));
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(session.getLabel()).toBeNull();
  });

  it("omits cwd filter when the session has no cwd recorded", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: "acp-1", cwd: "/vault", title: "Found me", updatedAt: null }],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).toHaveBeenCalledWith({});
    expect(session.getLabel()).toBe("Found me");
  });
});

describe("AgentSession plan proposal lifecycle", () => {
  it("does not resurrect the plan card when a late tool_call_update arrives for a finalized proposal", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const { turn } = session.sendPrompt("plan something");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-1",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: "# proposed plan body" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const initialPlan = session.getCurrentPlan();
    expect(initialPlan).not.toBeNull();
    expect(initialPlan?.decision).toBe("pending");
    expect(initialPlan?.pendingToolCallId).toBe("tc-plan-1");

    expect(session.finalizePlanDecision(initialPlan!.id)).toBe(true);
    expect(session.getCurrentPlan()).toBeNull();

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-plan-1",
        status: "completed",
        rawInput: { plan: "# proposed plan body" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    expect(session.getCurrentPlan()).toBeNull();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("propagates a body-identical setCurrentPlan when the gating state changes", async () => {
    // Regression: body-identical plan publications still need to propagate
    // control metadata such as pendingToolCallId. Otherwise a repeated
    // ExitPlanMode call can leave the UI resolving the wrong permission.
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const { turn } = session.sendPrompt("plan something");

    const planBody = "# proposed plan body";
    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-A",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: planBody },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const first = session.getCurrentPlan();
    expect(first?.pendingToolCallId).toBe("tc-plan-A");
    expect(first?.permissionGated).toBe(true);
    expect(first?.revision).toBe(1);

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-plan-B",
        title: "ExitPlanMode",
        kind: "other",
        status: "pending",
        rawInput: { plan: planBody },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
    });
    const second = session.getCurrentPlan();
    expect(second?.pendingToolCallId).toBe("tc-plan-B");
    expect(second?.permissionGated).toBe(true);
    // Body is byte-identical, so revision must NOT bump — the per-tab
    // `decided` reset effect in PlanPreviewView keys on revision and would
    // misfire if we treated this as an in-place content revision.
    expect(second?.revision).toBe(1);

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("does not promote completed plan-file writes into proposal cards", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
      initialState: {
        model: null,
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: { plan: { kind: "setMode", nativeId: "plan" } },
        },
      },
      getDescriptor: () =>
        ({
          isPlanModePlanFilePath: (absolutePath: string) =>
            absolutePath === "/Users/test/.claude/plans/plan.md",
        }) as unknown as BackendDescriptor,
    });
    const { turn } = session.sendPrompt("plan something");

    mock.emit({
      sessionId: "acp-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-plan-write",
        title: "Write",
        kind: "edit",
        status: "completed",
        rawInput: {
          file_path: "/Users/test/.claude/plans/plan.md",
          content: "# proposed plan body",
        },
      },
    });

    expect(session.getCurrentPlan()).toBeNull();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("publishes a gated plan from an ExitPlanMode permission request", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-from-permission",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: {
          plan: "# permission plan body",
          planFilePath: "/Users/test/.claude/plans/plan.md",
        },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    const plan = session.getCurrentPlan();
    expect(plan?.body).toBe("# permission plan body");
    expect(plan?.permissionGated).toBe(true);
    expect(plan?.pendingToolCallId).toBe("tc-plan-from-permission");
    expect(plan?.sourceFilePath).toBe("/Users/test/.claude/plans/plan.md");

    session.resolvePlanProposalPermission("tc-plan-from-permission", false);
    await decisionPromise;
  });

  it("forwards the optional denyMessage on resolvePlanProposalPermission to the resolved decision", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const { turn } = session.sendPrompt("plan something");

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-deny-msg",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: { plan: "# x" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    session.resolvePlanProposalPermission("tc-plan-deny-msg", false, "please drop step 2");
    const decision = await decisionPromise;

    expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
    expect(decision.denyMessage).toBe("please drop step 2");

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });

  it("does not attach denyMessage when allowing", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: "end_turn" }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      backendSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
    });
    const { turn } = session.sendPrompt("plan something");

    const decisionPromise = session.handlePlanProposalPermission({
      sessionId: "acp-1",
      toolCall: {
        toolCallId: "tc-plan-allow",
        kind: "switch_mode",
        status: "pending",
        title: "ExitPlanMode",
        rawInput: { plan: "# x" },
        vendorToolName: "ExitPlanMode",
        isPlanProposal: true,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
      ],
    });

    session.resolvePlanProposalPermission("tc-plan-allow", true, "should be ignored");
    const decision = await decisionPromise;

    expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(decision.denyMessage).toBeUndefined();

    resolvePrompt!({ stopReason: "end_turn" });
    await turn;
  });
});

describe("tryReadExitPlanModeCall", () => {
  it("returns the plan body when isPlanProposal is true", () => {
    const out = tryReadExitPlanModeCall({
      kind: "other",
      rawInput: { plan: "# do the thing" },
      isPlanProposal: true,
    });
    expect(out).toEqual({ plan: "# do the thing", planFilePath: undefined });
  });

  it("falls back to ACP kind=switch_mode when isPlanProposal is unset", () => {
    const out = tryReadExitPlanModeCall({
      kind: "switch_mode",
      rawInput: { plan: "## plan body", planFilePath: "/abs/plan.md" },
    });
    expect(out).toEqual({ plan: "## plan body", planFilePath: "/abs/plan.md" });
  });

  it("returns null when rawInput.plan is missing — content gate is load-bearing", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { planFilePath: "/abs/plan.md" },
        isPlanProposal: true,
      })
    ).toBeNull();
  });

  it("returns null when rawInput.plan is not a string", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "switch_mode",
        rawInput: { plan: 42 },
      })
    ).toBeNull();
  });

  it("returns null when neither isPlanProposal nor switch_mode kind matches", () => {
    expect(
      tryReadExitPlanModeCall({
        kind: "edit",
        rawInput: { plan: "looks like a plan but isn't tagged as one" },
      })
    ).toBeNull();
  });

  it("ignores planFilePath when it isn't a string", () => {
    const out = tryReadExitPlanModeCall({
      kind: "switch_mode",
      rawInput: { plan: "body", planFilePath: 12 },
    });
    expect(out).toEqual({ plan: "body", planFilePath: undefined });
  });

  it("handles null/undefined rawInput without throwing", () => {
    expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: null })).toBeNull();
    expect(tryReadExitPlanModeCall({ kind: "switch_mode", rawInput: undefined })).toBeNull();
  });
});
