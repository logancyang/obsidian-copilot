import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionNotification } from "@agentclientprotocol/sdk";

const queryMock = jest.fn();
const createSdkMcpServerMock = jest.fn(
  (opts: unknown) => ({ type: "sdk", instance: opts }) as unknown
);

jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  createSdkMcpServer: (opts: unknown) => createSdkMcpServerMock(opts),
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: false } }),
}));

jest.mock("@/agentMode/acp/frameSink", () => ({
  frameSink: { append: jest.fn() },
}));

import { ClaudeSdkBackendProcess } from "./ClaudeSdkBackendProcess";

function makeQuery(messages: SDKMessage[]) {
  const iter = (async function* () {
    for (const m of messages) yield m;
  })();
  return Object.assign(iter, {
    interrupt: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
  });
}

function streamEvent(event: object): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "uuid-x" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  } as SDKMessage;
}

function resultMessage(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: {} as any,
    modelUsage: {},
    permission_denials: [],
    uuid: "uuid-r" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  } as SDKMessage;
}

describe("ClaudeSdkBackendProcess.prompt happy path", () => {
  beforeEach(() => {
    queryMock.mockReset();
    createSdkMcpServerMock.mockClear();
  });

  it("translates SDK text deltas to agent_message_chunk and resolves with end_turn", async () => {
    queryMock.mockImplementation(() =>
      makeQuery([
        streamEvent({ type: "message_start", message: {} }),
        streamEvent({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hello" },
        }),
        resultMessage(),
      ])
    );

    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(sessionId).toBeTruthy();

    const updates: SessionNotification[] = [];
    proc.registerSessionHandler(sessionId, (n) => updates.push(n));

    const resp = await proc.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    expect(resp.stopReason).toBe("end_turn");

    const chunks = updates.filter((u) => u.update.sessionUpdate === "agent_message_chunk");
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0].update;
    if (chunk.sessionUpdate === "agent_message_chunk" && chunk.content.type === "text") {
      expect(chunk.content.text).toBe("hello");
    } else {
      throw new Error("expected agent_message_chunk text update");
    }

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0][0];
    expect(call.options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
    expect(Object.keys(call.options.mcpServers)).toContain("obsidian-vault");
    expect(call.options.disallowedTools).toEqual(["Read", "Write", "Edit"]);
    // First turn → sessionId is seeded, no resume.
    expect(call.options.sessionId).toBe(sessionId);
    expect(call.options.resume).toBeUndefined();
  });

  it("buffers notifications emitted before a session handler is registered and replays them", async () => {
    queryMock.mockImplementation(() =>
      makeQuery([
        streamEvent({ type: "message_start", message: {} }),
        streamEvent({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "buffered" },
        }),
        resultMessage(),
      ])
    );

    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    // Kick off prompt without a handler — notifications are buffered.
    const promptPromise = proc.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    const seen: SessionNotification[] = [];
    proc.registerSessionHandler(sessionId, (n) => seen.push(n));
    await promptPromise;

    const chunks = seen.filter((u) => u.update.sessionUpdate === "agent_message_chunk");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("passes resume on the second prompt for the same session", async () => {
    queryMock.mockImplementation(() => makeQuery([resultMessage()]));

    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    proc.registerSessionHandler(sessionId, () => {});

    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const second = queryMock.mock.calls[1][0];
    expect(second.options.resume).toBe(sessionId);
    expect(second.options.sessionId).toBeUndefined();
  });
});
