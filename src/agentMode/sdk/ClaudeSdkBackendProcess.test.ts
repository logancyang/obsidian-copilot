import type { ModelInfo, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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

const FAKE_CATALOG: ModelInfo[] = [
  {
    value: "claude-fake-pro",
    displayName: "Claude Fake Pro",
    description: "test",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "claude-fake-mini",
    displayName: "Claude Fake Mini",
    description: "test",
    supportsEffort: false,
  },
];

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: false } }),
}));

jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: () => "",
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

/**
 * Tests pass `getCachedCatalog` to skip the probe path; only prompt
 * `query()` calls go through `queryMock`. This filter remains in case a
 * future test exercises the lazy-probe fallback (which carries no `cwd`).
 */
function getPromptQueryCalls(): unknown[][] {
  return queryMock.mock.calls.filter((c) => {
    const opts = (c[0] as { options?: { cwd?: unknown } } | undefined)?.options;
    return opts?.cwd !== undefined;
  });
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
      getCachedCatalog: () => FAKE_CATALOG,
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

    const promptCalls = getPromptQueryCalls();
    expect(promptCalls).toHaveLength(1);
    const call = promptCalls[0][0] as { options: Record<string, unknown> };
    expect(call.options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
    expect(Object.keys(call.options.mcpServers as object)).toContain("obsidian-vault");
    expect(call.options.disallowedTools).toEqual(["Read", "Edit"]);
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
      getCachedCatalog: () => FAKE_CATALOG,
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
      getCachedCatalog: () => FAKE_CATALOG,
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    proc.registerSessionHandler(sessionId, () => {});

    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });

    const promptCalls = getPromptQueryCalls();
    expect(promptCalls).toHaveLength(2);
    const second = promptCalls[1][0] as { options: Record<string, unknown> };
    expect(second.options.resume).toBe(sessionId);
    expect(second.options.sessionId).toBeUndefined();
  });
});

describe("ClaudeSdkBackendProcess.newSession dynamic catalog", () => {
  beforeEach(() => {
    queryMock.mockReset();
    createSdkMcpServerMock.mockClear();
  });

  it("returns models + synthesized effort configOption from the cached catalog", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      getCachedCatalog: () => FAKE_CATALOG,
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.models?.currentModelId).toBe("claude-fake-pro");
    expect(resp.models?.availableModels).toEqual([
      { modelId: "claude-fake-pro", name: "Claude Fake Pro" },
      { modelId: "claude-fake-mini", name: "Claude Fake Mini" },
    ]);
    expect(resp.configOptions).toHaveLength(1);
    const opt = resp.configOptions?.[0];
    expect(opt?.id).toBe("effort");
    if (opt && opt.type === "select") {
      expect(opt.currentValue).toBe("low");
      expect(opt.options.map((o) => ("value" in o ? o.value : null))).toEqual([
        "low",
        "medium",
        "high",
      ]);
    } else {
      throw new Error("expected select-type effort option");
    }
  });

  it("honors persisted preferred model when it appears in the catalog", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      getCachedCatalog: () => FAKE_CATALOG,
      getPreferredModelId: () => "claude-fake-mini",
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.models?.currentModelId).toBe("claude-fake-mini");
    // claude-fake-mini doesn't support effort → no configOption
    expect(resp.configOptions).toBeUndefined();
  });

  it("falls back to catalog default when the preferred model is gone", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      getCachedCatalog: () => FAKE_CATALOG,
      getPreferredModelId: () => "claude-removed-by-cli-upgrade",
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.models?.currentModelId).toBe("claude-fake-pro");
  });

  it("seeds session.model so prompt() sends options.model", async () => {
    queryMock.mockImplementation(() => makeQuery([resultMessage()]));
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      getCachedCatalog: () => FAKE_CATALOG,
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    proc.registerSessionHandler(sessionId, () => {});
    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

    const promptCalls = getPromptQueryCalls();
    expect(promptCalls).toHaveLength(1);
    const call = promptCalls[0][0] as { options: { model?: string } };
    expect(call.options.model).toBe("claude-fake-pro");
  });

  it("setSessionConfigOption('effort', …) clamps + persists the level on the session", async () => {
    queryMock.mockImplementation(() => makeQuery([resultMessage()]));
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      getCachedCatalog: () => FAKE_CATALOG,
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    proc.registerSessionHandler(sessionId, () => {});
    const setResp = await proc.setSessionConfigOption({
      sessionId,
      configId: "effort",
      value: "high",
    });
    expect(setResp.configOptions).toHaveLength(1);

    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    const promptCalls = getPromptQueryCalls();
    expect(promptCalls).toHaveLength(1);
    const call = promptCalls[0][0] as { options: { effort?: string } };
    expect(call.options.effort).toBe("high");
  });
});
