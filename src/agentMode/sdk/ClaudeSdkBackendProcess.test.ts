import type { ModelInfo, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BackendDescriptor, SessionEvent } from "@/agentMode/session/types";

const queryMock = jest.fn();
const createSdkMcpServerMock = jest.fn((opts: unknown) => ({ type: "sdk", instance: opts }));

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

jest.mock("./effortOption", () => ({
  ...jest.requireActual("./effortOption"),
  getCachedSdkCatalog: jest.fn(),
}));

import { ClaudeSdkBackendProcess, promptInputToAnthropicContent } from "./ClaudeSdkBackendProcess";
import { getCachedSdkCatalog } from "./effortOption";

beforeEach(() => {
  (getCachedSdkCatalog as jest.Mock).mockReturnValue(FAKE_CATALOG);
});

function fakeDescriptor(): BackendDescriptor {
  return {
    id: "claude",
    displayName: "Claude",
    showModelDescriptions: true,
    wire: {
      encode: (sel: { baseModelId: string; effort: string | null }) => sel.baseModelId,
      decode: (id: string) => ({
        selection: { baseModelId: id, effort: null },
        provider: "anthropic",
      }),
      effortConfigFor: (baseModelId: string) => {
        const m = FAKE_CATALOG.find((x) => x.value === baseModelId);
        if (!m?.supportsEffort) return null;
        const levels = m.supportedEffortLevels ?? [];
        if (levels.length === 0) return null;
        return {
          id: "effort",
          type: "select",
          category: "thought_level",
          name: "Effort",
          currentValue: levels[0],
          options: levels.map((v) => ({ value: v, name: v })),
        };
      },
    },
  } as unknown as BackendDescriptor;
}

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
  };
}

function getPromptQueryCalls(): unknown[][] {
  return queryMock.mock.calls.filter((c) => {
    const opts = (c[0] as { options?: { cwd?: unknown } } | undefined)?.options;
    return opts?.cwd !== undefined;
  });
}

describe("promptInputToAnthropicContent", () => {
  it("returns a plain string when the prompt is text-only", () => {
    const result = promptInputToAnthropicContent({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    });
    expect(result).toBe("hello\nworld");
  });

  it("returns content blocks when an image is attached", () => {
    const result = promptInputToAnthropicContent({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "describe" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ],
    });
    expect(result).toEqual([
      { type: "text", text: "describe" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
      },
    ]);
  });

  it("normalizes jpg media types before sending image blocks", () => {
    const result = promptInputToAnthropicContent({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "describe" },
        { type: "image", mimeType: "image/jpg", data: "aGVsbG8=" },
      ],
    });
    expect(result).toEqual([
      { type: "text", text: "describe" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" },
      },
    ]);
  });

  it("omits image media types Anthropic does not accept", () => {
    const result = promptInputToAnthropicContent({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "describe" },
        { type: "image", mimeType: "image/heic", data: "aGVsbG8=" },
      ],
    });
    expect(result).toEqual([
      { type: "text", text: "describe" },
      { type: "text", text: "[Unsupported image attachment omitted: image/heic]" },
    ]);
  });

  it("represents resource_link as a defensive text reference", () => {
    const result = promptInputToAnthropicContent({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "see the doc" },
        { type: "resource_link", uri: "vault://README.md", name: "README" },
        { type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" },
      ],
    });
    expect(result).toEqual([
      { type: "text", text: "see the doc" },
      { type: "text", text: "[Attached resource: README]" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "ZmFrZQ==" },
      },
    ]);
  });
});

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
      descriptor: fakeDescriptor(),
    });

    const { sessionId, state } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(sessionId).toBeTruthy();
    expect(state.model?.current.baseModelId).toBe("claude-fake-pro");

    const events: SessionEvent[] = [];
    proc.registerSessionHandler(sessionId, (e) => events.push(e));

    const resp = await proc.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    expect(resp.stopReason).toBe("end_turn");

    const chunks = events.filter((u) => u.update.sessionUpdate === "agent_message_chunk");
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
    expect(Object.keys(call.options.mcpServers as object)).not.toContain("obsidian-vault");
    expect(call.options.allowedTools).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "LS"]);
    expect(call.options.disallowedTools).toBeUndefined();
    // First turn → sessionId is seeded, no resume.
    expect(call.options.sessionId).toBe(sessionId);
    expect(call.options.resume).toBeUndefined();
    // No skill-creation directive opt passed → no systemPrompt override.
    expect(call.options.systemPrompt).toBeUndefined();
  });

  it("forwards the composed system prompt via systemPrompt append on the claude_code preset", async () => {
    queryMock.mockImplementation(() =>
      makeQuery([streamEvent({ type: "message_start", message: {} }), resultMessage()])
    );

    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
      getSystemPromptAppend: () => "DO THIS THING WITH SKILLS",
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

    const calls = getPromptQueryCalls();
    const opts = (calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "DO THIS THING WITH SKILLS",
    });
  });

  it("captures the system prompt at newSession time and ignores later setting changes mid-session", async () => {
    queryMock.mockImplementation(() =>
      makeQuery([streamEvent({ type: "message_start", message: {} }), resultMessage()])
    );

    let current = "FIRST DIRECTIVE";
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
      getSystemPromptAppend: () => current,
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    // Mutate the "setting" after newSession → the session's first turn must
    // still use the original prompt, proving capture-at-newSession semantics.
    current = "SECOND DIRECTIVE";
    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

    const opts = (getPromptQueryCalls()[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "FIRST DIRECTIVE",
    });
  });

  // The SDK adapter's contract is "forward `getSystemPromptAppend()` verbatim
  // into `options.systemPrompt.append`", proven above. The Claude descriptor
  // wires that callback to `buildAgentSystemPrompt`, whose composition — the
  // Copilot base prompt, pill directive, user custom prompt, and the
  // disable-builtin behavior — is unit-tested in
  // `backends/shared/agentSystemPrompt.test.ts`. (The `sdk` layer can't import
  // a `backend` module under `boundaries/dependencies`, so that assertion
  // lives there, not here.)

  it("buffers events emitted before a session handler is registered and replays them", async () => {
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
      descriptor: fakeDescriptor(),
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    // Kick off prompt without a handler — events are buffered.
    const promptPromise = proc.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });

    const seen: SessionEvent[] = [];
    proc.registerSessionHandler(sessionId, (e) => seen.push(e));
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
      descriptor: fakeDescriptor(),
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

  it("returns BackendState with current model + effort options from the cached catalog", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
    const ids = resp.state.model?.availableModels.map((m) => m.baseModelId);
    expect(ids).toContain("claude-fake-pro");
    expect(ids).toContain("claude-fake-mini");
    const pro = resp.state.model?.availableModels.find((m) => m.baseModelId === "claude-fake-pro");
    expect(pro?.effortOptions.map((o) => o.value)).toEqual(["low", "medium", "high"]);
    // The SDK's per-model `description` is carried into the entry (used as the
    // capability second line in the picker + settings).
    expect(pro?.description).toBe("test");
  });

  it("honors persisted default model when it appears in the catalog", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
      getDefaultModelId: () => "claude-fake-mini",
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.state.model?.current.baseModelId).toBe("claude-fake-mini");
    const miniEffort = resp.state.model?.availableModels.find(
      (m) => m.baseModelId === "claude-fake-mini"
    )?.effortOptions;
    expect(miniEffort).toEqual([]);
  });

  it("falls back to catalog default when the default model is gone", async () => {
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
      getDefaultModelId: () => "claude-removed-by-cli-upgrade",
    });

    const resp = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
  });

  it("seeds session.model so prompt() sends options.model", async () => {
    queryMock.mockImplementation(() => makeQuery([resultMessage()]));
    const proc = new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app: { vault: {} } as any,
      clientVersion: "1.2.3",
      descriptor: fakeDescriptor(),
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
      descriptor: fakeDescriptor(),
    });

    const { sessionId } = await proc.newSession({ cwd: "/vault", mcpServers: [] });
    proc.registerSessionHandler(sessionId, () => {});
    const stateAfter = await proc.setSessionConfigOption({
      sessionId,
      configId: "effort",
      value: "high",
    });
    expect(stateAfter.model?.current.effort).toBe("high");

    await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
    const promptCalls = getPromptQueryCalls();
    expect(promptCalls).toHaveLength(1);
    const call = promptCalls[0][0] as { options: { effort?: string } };
    expect(call.options.effort).toBe("high");
  });
});
