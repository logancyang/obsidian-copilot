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
  const backend = {
    registerSessionHandler: registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    isSetSessionModelSupported,
  } as unknown as AcpBackendProcess;
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    newSession,
    setSessionModel,
    isSetSessionModelSupported,
    emit: (update) => handler?.(update as Parameters<SessionUpdateHandler>[0]),
  };
}

describe("AgentSession.sendPrompt", () => {
  it("appends user + placeholder synchronously and resolves on stopReason", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
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
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
    session.sendPrompt("first");
    expect(() => session.sendPrompt("second")).toThrow(/in flight/);
  });

  it("agent_message_chunk is appended to placeholder displayText", async () => {
    const mock = makeMockBackend();
    let resolvePrompt: ((v: { stopReason: string }) => void) | null = null;
    mock.prompt.mockImplementation(
      () => new Promise((resolve) => (resolvePrompt = resolve as typeof resolvePrompt))
    );
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
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
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
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
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
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
    const session = await AgentSession.create(mock.asBackend, "/vault", "internal-1");
    expect(session.getModelState()?.currentModelId).toBe("anthropic/sonnet");
    expect(session.getModelState()?.availableModels).toHaveLength(2);
  });

  it("getModelState returns null when the agent doesn't report models", async () => {
    const mock = makeMockBackend();
    mock.newSession.mockResolvedValueOnce({ sessionId: "acp-1", models: null });
    const session = await AgentSession.create(mock.asBackend, "/vault", "internal-1");
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
    await AgentSession.create(mock.asBackend, "/vault", "internal-1", "openai/gpt-5");
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
    await AgentSession.create(mock.asBackend, "/vault", "internal-1", "anthropic/sonnet");
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
    await AgentSession.create(mock.asBackend, "/vault", "internal-1", "ghost/model");
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
    const session = await AgentSession.create(
      mock.asBackend,
      "/vault",
      "internal-1",
      "openai/gpt-5"
    );
    // Session is still usable; current model stays at the agent's default.
    expect(session.getModelState()?.currentModelId).toBe("anthropic/sonnet");
  });
});

describe("AgentSession.setModel", () => {
  it("calls backend.setSessionModel and updates currentModelId on success", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1", {
      currentModelId: "a/b",
      availableModels: [
        { modelId: "a/b", name: "A B" },
        { modelId: "x/y", name: "X Y" },
      ],
    });
    await session.setModel("x/y");
    expect(mock.setSessionModel).toHaveBeenCalledWith({ sessionId: "acp-1", modelId: "x/y" });
    expect(session.getModelState()?.currentModelId).toBe("x/y");
  });

  it("rethrows MethodUnsupportedError without mutating local state", async () => {
    const mock = makeMockBackend();
    mock.setSessionModel.mockRejectedValueOnce(new MethodUnsupportedError("session/set_model"));
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1", {
      currentModelId: "a/b",
      availableModels: [{ modelId: "a/b", name: "A B" }],
    });
    await expect(session.setModel("x/y")).rejects.toBeInstanceOf(MethodUnsupportedError);
    expect(session.getModelState()?.currentModelId).toBe("a/b");
  });

  it("notifies onModelChanged listeners after successful switch", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1", {
      currentModelId: "a/b",
      availableModels: [
        { modelId: "a/b", name: "A B" },
        { modelId: "x/y", name: "X Y" },
      ],
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
