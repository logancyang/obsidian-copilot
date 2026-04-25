import { AI_SENDER, USER_SENDER } from "@/constants";
import { AcpBackendProcess, SessionUpdateHandler } from "./AcpBackendProcess";
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
  const backend = {
    registerSessionHandler: registerHandler,
    prompt,
    cancel,
  } as unknown as AcpBackendProcess;
  return {
    asBackend: backend,
    registerHandler,
    prompt,
    cancel,
    emit: (update) => handler?.(update as Parameters<SessionUpdateHandler>[0]),
  };
}

describe("AgentSession.sendPrompt", () => {
  it("appends user + placeholder synchronously and resolves on stopReason", async () => {
    const mock = makeMockBackend();
    const session = new AgentSession(mock.asBackend, "acp-1", "internal-1");
    const { userMessageId, turn } = session.sendPrompt("Hi there");

    const messages = session.repo.getDisplayMessages();
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

    const placeholder = session.repo.getDisplayMessages().find((m) => m.sender === AI_SENDER);
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

    const placeholder = session.repo.getDisplayMessages().find((m) => m.sender === AI_SENDER);
    expect(placeholder?.agentParts).toHaveLength(1);
    expect(placeholder?.agentParts?.[0]).toMatchObject({
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
