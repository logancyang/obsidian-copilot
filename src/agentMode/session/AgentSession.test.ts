import { AI_SENDER, USER_SENDER } from "@/constants";
import { AcpBackendProcess, SessionUpdateHandler } from "@/agentMode/acp/AcpBackendProcess";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import { AgentSession } from "./AgentSession";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

interface MockBackend {
  asBackend: AcpBackendProcess;
  registerHandler: jest.Mock;
  emit: (update: unknown) => void;
  prompt: jest.Mock;
  cancel: jest.Mock;
  newSession: jest.Mock;
  setSessionModel: jest.Mock;
  isSetSessionModelSupported: jest.Mock;
  setSessionConfigOption: jest.Mock;
  isSetSessionConfigOptionSupported: jest.Mock;
  listSessions: jest.Mock;
  isListSessionsSupported: jest.Mock;
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
  const newSession = jest.fn(async () => ({ sessionId: "acp-1", models: null }));
  const setSessionModel = jest.fn(async () => ({}));
  const isSetSessionModelSupported = jest.fn(() => true);
  const setSessionConfigOption = jest.fn(async () => ({ configOptions: [] }));
  const isSetSessionConfigOptionSupported = jest.fn(() => true);
  const listSessions = jest.fn(async () => ({ sessions: [] }));
  const isListSessionsSupported = jest.fn(() => true);
  const backend = {
    registerSessionHandler: registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    isSetSessionModelSupported,
    setSessionConfigOption,
    isSetSessionConfigOptionSupported,
    listSessions,
    isListSessionsSupported,
  } as unknown as AcpBackendProcess;
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    isSetSessionModelSupported,
    setSessionConfigOption,
    isSetSessionConfigOptionSupported,
    listSessions,
    isListSessionsSupported,
    emit: (update) => handler?.(update as Parameters<SessionUpdateHandler>[0]),
  };
}

describe("AgentSession.sendPrompt", () => {
  it("appends user + placeholder synchronously and resolves on stopReason", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    session.sendPrompt("first");
    expect(() => session.sendPrompt("second")).toThrow(/in flight/);
  });

  it("agent_message_chunk is appended to placeholder displayText", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: string }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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
    let resolvePrompt: ((v: { stopReason: string }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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

  it("cancel() sends ACP cancel and aborts local controller", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: string }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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

describe("AgentSession.create", () => {
  it("captures `models` from NewSessionResponse and exposes via getModelState", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({
      sessionId: "acp-1",
      models: {
        currentModelId: "anthropic/sonnet",
        availableModels: [
          { modelId: "anthropic/sonnet", name: "Claude Sonnet" },
          { modelId: "openai/gpt-5", name: "GPT-5" },
        ],
      },
    });
    const session = await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    expect(session.getModelState()?.currentModelId).toBe("anthropic/sonnet");
    expect(session.getModelState()?.availableModels).toHaveLength(2);
  });

  it("getModelState returns null when the agent doesn't report models", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", models: null });
    const session = await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
    });
    expect(session.getModelState()).toBeNull();
  });

  it("applies preferredModelId when it differs from current and is available", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({
      sessionId: "acp-1",
      models: {
        currentModelId: "anthropic/sonnet",
        availableModels: [
          { modelId: "anthropic/sonnet", name: "Claude Sonnet" },
          { modelId: "openai/gpt-5", name: "GPT-5" },
        ],
      },
    });
    await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      preferredModelId: "openai/gpt-5",
    });
    expect(mock.setSessionModel).toHaveBeenCalledWith({
      sessionId: "acp-1",
      modelId: "openai/gpt-5",
    });
  });

  it("does not switch when preferredModelId matches current", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({
      sessionId: "acp-1",
      models: {
        currentModelId: "anthropic/sonnet",
        availableModels: [{ modelId: "anthropic/sonnet", name: "Claude Sonnet" }],
      },
    });
    await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      preferredModelId: "anthropic/sonnet",
    });
    expect(mock.setSessionModel).not.toHaveBeenCalled();
  });

  it("does not switch when preferredModelId is not in availableModels", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({
      sessionId: "acp-1",
      models: {
        currentModelId: "anthropic/sonnet",
        availableModels: [{ modelId: "anthropic/sonnet", name: "Claude Sonnet" }],
      },
    });
    await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      preferredModelId: "ghost/model",
    });
    expect(mock.setSessionModel).not.toHaveBeenCalled();
  });

  it("survives a MethodUnsupportedError from preferred-model application", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({
      sessionId: "acp-1",
      models: {
        currentModelId: "anthropic/sonnet",
        availableModels: [
          { modelId: "anthropic/sonnet", name: "Claude Sonnet" },
          { modelId: "openai/gpt-5", name: "GPT-5" },
        ],
      },
    });
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = await AgentSession.create({
      backend: mock.asBackend,
      cwd: "/vault",
      internalId: "internal-1",
      backendId: "opencode",
      preferredModelId: "openai/gpt-5",
    });
    // Session is still usable; current model stays at the agent's default.
    expect(session.getModelState()?.currentModelId).toBe("anthropic/sonnet");
  });
});

describe("AgentSession.setModel", () => {
  it("calls backend.setSessionModel and updates currentModelId on success", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      initialModelState: {
        currentModelId: "a/b",
        availableModels: [
          { modelId: "a/b", name: "A B" },
          { modelId: "x/y", name: "X Y" },
        ],
      },
    });
    await session.setModel("x/y");
    expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "x/y" });
    expect(session.getModelState()?.currentModelId).toBe("x/y");
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      initialModelState: {
        currentModelId: "a/b",
        availableModels: [{ modelId: "a/b", name: "A B" }],
      },
    });
    await expect(session.setModel("x/y")).rejects.toBeInstanceOf(MethodUnsupportedError);
    expect(session.getModelState()?.currentModelId).toBe("a/b");
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      initialModelState: {
        currentModelId: "a/b",
        availableModels: [
          { modelId: "a/b", name: "A B" },
          { modelId: "x/y", name: "X Y" },
        ],
      },
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
  it("forwards to backend and replaces local cache from response", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockResolvedValueOnce({
      configOptions: [
        {
          id: "effort",
          category: "effort",
          type: "select",
          name: "Effort",
          currentValue: "high",
          options: [{ value: "high", name: "High" }],
        },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
      initialConfigOptions: [
        {
          id: "effort",
          category: "effort",
          type: "select",
          name: "Effort",
          currentValue: "medium",
          options: [
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
    });
    await session.setConfigOption("effort", "high");
    expect(mock.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "acp-1",
      configId: "effort",
      value: "high",
    });
    const opts = session.getConfigOptions();
    expect(opts).toHaveLength(1);
    expect(opts![0]).toMatchObject({ id: "effort", currentValue: "high" });
  });

  it("notifies onModelChanged subscribers on success", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockResolvedValueOnce({ configOptions: [] });
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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

  it("rethrows MethodUnsupportedError without mutating cache", async () => {
    const mock = makeMockBackend();
    mock.setSessionConfigOption.mockRejectedValueOnce(
      new MethodUnsupportedError("session/set_config_option")
    );
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "claude-code",
      initialConfigOptions: [
        {
          id: "effort",
          category: "effort",
          type: "select",
          name: "Effort",
          currentValue: "medium",
          options: [{ value: "medium", name: "Medium" }],
        },
      ],
    });
    await expect(session.setConfigOption("effort", "high")).rejects.toBeInstanceOf(
      MethodUnsupportedError
    );
    const opts = session.getConfigOptions();
    expect(opts![0]).toMatchObject({ currentValue: "medium" });
  });
});

describe("AgentSession.setLabel", () => {
  it("stores trimmed label and notifies onLabelChanged", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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

    // Empty / whitespace clears the label.
    session.setLabel("   ");
    expect(session.getLabel()).toBeNull();
    expect(onLabelChanged).toHaveBeenCalledTimes(2);

    // Idempotent set is a no-op.
    session.setLabel(null);
    expect(onLabelChanged).toHaveBeenCalledTimes(2);
  });
});

describe("AgentSession session_info_update", () => {
  it("adopts the title pushed by the agent and notifies listeners", () => {
    const mock = makeMockBackend();
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    // No sendPrompt() — so placeholderId is null. Should still work.
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
      acpSessionId: "acp-1",
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
  // The poll is fire-and-forget inside runTurn — yield twice so the
  // listSessions promise and its `.then` callback both run.
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("pulls the title via session/list and applies it after end_turn", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockResolvedValueOnce({
      sessions: [
        { sessionId: "acp-1", cwd: "/vault", title: "Refactor auth", updatedAt: null },
        { sessionId: "acp-other", cwd: "/vault", title: "Different session", updatedAt: null },
      ],
    });
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
      cwd: "/vault",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).not.toHaveBeenCalled();
  });

  it("silently no-ops when the agent doesn't support session/list", async () => {
    const mock = makeMockBackend();
    mock.listSessions.mockRejectedValueOnce(new MethodUnsupportedError("session/list"));
    const session = new AgentSession({
      backend: mock.asBackend,
      acpSessionId: "acp-1",
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
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    await session.sendPrompt("hi").turn;
    await flushMicrotasks();
    expect(mock.listSessions).toHaveBeenCalledWith({});
    expect(session.getLabel()).toBe("Found me");
  });
});

describe("AgentSession multi-session routing", () => {
  it("two sessions on one backend each receive only their routed updates", async () => {
    // Build a backend that supports a real per-session-id handler map (the
    // shared makeMockBackend helper only stores one handler).
    const handlers = new Map<string, (u: unknown) => void>();
    const prompt = jest.fn(async () => ({ stopReason: "end_turn" as const }));
    const backend = {
      registerSessionHandler: (id: string, h: (u: unknown) => void) => {
        handlers.set(id, h);
        return () => {
          if (handlers.get(id) === h) handlers.delete(id);
        };
      },
      prompt,
      cancel: jest.fn(async () => undefined),
      newSession: jest.fn(),
      setSessionModel: jest.fn(),
      isSetSessionModelSupported: jest.fn(() => null),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      isListSessionsSupported: jest.fn(() => true),
    } as unknown as AcpBackendProcess;

    const sessionA = new AgentSession({
      backend,
      acpSessionId: "acp-A",
      internalId: "internal-A",
      backendId: "opencode",
    });
    const sessionB = new AgentSession({
      backend,
      acpSessionId: "acp-B",
      internalId: "internal-B",
      backendId: "opencode",
    });

    let resolveA: ((v: { stopReason: string }) => void) | null = null;
    let resolveB: ((v: { stopReason: string }) => void) | null = null;
    prompt.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve as typeof resolveA))
    );
    prompt.mockImplementationOnce(
      () => new Promise((resolve) => (resolveB = resolve as typeof resolveB))
    );

    const turnA = sessionA.sendPrompt("hi A").turn;
    const turnB = sessionB.sendPrompt("hi B").turn;

    // Route a chunk to session A only.
    handlers.get("acp-A")!({
      sessionId: "acp-A",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fromA" } },
    });
    // Route a chunk to session B only.
    handlers.get("acp-B")!({
      sessionId: "acp-B",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fromB" } },
    });

    const aiA = sessionA.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    const aiB = sessionB.store.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(aiA?.message).toBe("fromA");
    expect(aiB?.message).toBe("fromB");

    resolveA!({ stopReason: "end_turn" });
    resolveB!({ stopReason: "end_turn" });
    await Promise.all([turnA, turnB]);
  });

  it("dispose() unregisters the session handler", () => {
    const handlers = new Map<string, (u: unknown) => void>();
    const backend = {
      registerSessionHandler: (id: string, h: (u: unknown) => void) => {
        handlers.set(id, h);
        return () => {
          if (handlers.get(id) === h) handlers.delete(id);
        };
      },
      prompt: jest.fn(),
      cancel: jest.fn(),
      newSession: jest.fn(),
      setSessionModel: jest.fn(),
      isSetSessionModelSupported: jest.fn(() => null),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      isListSessionsSupported: jest.fn(() => true),
    } as unknown as AcpBackendProcess;

    const session = new AgentSession({
      backend,
      acpSessionId: "acp-1",
      internalId: "internal-1",
      backendId: "opencode",
    });
    expect(handlers.has("acp-1")).toBe(true);
    session.dispose();
    expect(handlers.has("acp-1")).toBe(false);
  });
});
