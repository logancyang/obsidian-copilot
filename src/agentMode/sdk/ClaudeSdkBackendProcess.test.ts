import type {
  CanUseTool,
  HookCallback,
  ModelInfo,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { BackendDescriptor, SessionEvent } from "@/agentMode/session/types";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

import {
  ClaudeSdkBackendProcess,
  type ClaudeSdkBackendProcessOptions,
  enforceForegroundToolUse,
  promptInputToAnthropicContent,
} from "./ClaudeSdkBackendProcess";
import { getCachedSdkCatalog } from "./effortOption";
import { AuthRequiredError } from "@/agentMode/session/errors";

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

function makeControlledQuery() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const iter = (async function* () {
    await finished;
    yield resultMessage();
  })();
  return {
    query: Object.assign(iter, {
      interrupt: jest.fn().mockResolvedValue(undefined),
      setModel: jest.fn().mockResolvedValue(undefined),
      setPermissionMode: jest.fn().mockResolvedValue(undefined),
    }),
    finish,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
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

const USAGE_LIMIT_MESSAGE = "You've hit your session limit · resets 6:30pm (America/New_York)";

function usageLimitMessages(): SDKMessage[] {
  return [
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt: 1_784_154_600,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        overageDisabledReason: "org_level_disabled",
        isUsingOverage: false,
      },
      uuid: "uuid-limit" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "irrelevant",
    },
    {
      type: "assistant",
      error: "rate_limit",
      message: {
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "stop_sequence",
        content: [{ type: "text", text: USAGE_LIMIT_MESSAGE }],
      },
      parent_tool_use_id: null,
      uuid: "uuid-assistant" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "irrelevant",
    },
    {
      ...resultMessage(),
      is_error: true,
      api_error_status: 429,
      result: USAGE_LIMIT_MESSAGE,
      stop_reason: "stop_sequence",
    },
  ] as SDKMessage[];
}

function getPromptQueryCalls(): unknown[][] {
  return queryMock.mock.calls.filter((c) => {
    const opts = (c[0] as { options?: { cwd?: unknown } } | undefined)?.options;
    return opts?.cwd !== undefined;
  });
}

function makeProc(extra: Partial<ClaudeSdkBackendProcessOptions> = {}): ClaudeSdkBackendProcess {
  return new ClaudeSdkBackendProcess({
    pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    app: { vault: {} } as unknown as import("obsidian").App,
    clientVersion: "1.2.3",
    descriptor: fakeDescriptor(),
    ...extra,
  });
}

const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";

const WEEKLY_21_PERCENT = {
  rate_limits_available: true,
  rate_limits: { seven_day: { utilization: 21 } },
};

async function promptReportingPlanUsage(
  proc: ClaudeSdkBackendProcess,
  sessionId: string,
  usage: () => Promise<unknown>
): Promise<void> {
  queryMock.mockImplementationOnce(() =>
    Object.assign(makeQuery([resultMessage()]), { [USAGE_METHOD]: usage })
  );
  await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
  await flushMicrotasks();
}

function planUsageUpdates(events: SessionEvent[]): SessionEvent["update"][] {
  return events.map((e) => e.update).filter((u) => u.sessionUpdate === "plan_usage_update");
}

function registerCollector(proc: ClaudeSdkBackendProcess, sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  proc.registerSessionHandler(sessionId, (e) => events.push(e));
  return events;
}

function errorResultMessage(errors: string[]): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: {} as any,
    modelUsage: {},
    permission_denials: [],
    errors,
    uuid: "uuid-e" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  };
}

describe("ClaudeSdkBackendProcess", () => {
  describe("promptInputToAnthropicContent()", () => {
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

  describe("enforceForegroundToolUse()", () => {
    const invoke = (toolName: string, toolInput: unknown) =>
      enforceForegroundToolUse(
        {
          hook_event_name: "PreToolUse",
          tool_name: toolName,
          tool_input: toolInput,
          tool_use_id: "tool-1",
        } as Parameters<HookCallback>[0],
        "tool-1",
        { signal: new AbortController().signal }
      );

    it.each(["Agent", "Task", "Bash"])(
      "forces %s to the foreground while preserving its other input",
      async (toolName) => {
        await expect(
          invoke(toolName, { description: "Inspect the vault", run_in_background: true })
        ).resolves.toEqual({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            updatedInput: {
              description: "Inspect the vault",
              run_in_background: false,
            },
          },
        });
      }
    );

    it.each(["Agent", "Task"])("denies a remote-isolated %s", async (toolName) => {
      await expect(
        invoke(toolName, { description: "Inspect remotely", isolation: "remote" })
      ).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("temporarily unavailable"),
        },
      });
    });

    it("keeps worktree-isolated agents synchronous", async () => {
      await expect(invoke("Agent", { isolation: "worktree" })).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { isolation: "worktree", run_in_background: false },
        },
      });
    });

    it("normalizes malformed foreground-tool input without throwing", async () => {
      await expect(invoke("Bash", null)).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { run_in_background: false },
        },
      });
    });

    it("leaves unrelated tools unchanged", async () => {
      await expect(invoke("Read", { file_path: "note.md" })).resolves.toEqual({});
    });
  });

  describe("ClaudeSdkBackendProcess", () => {
    beforeEach(() => {
      queryMock.mockReset();
      createSdkMcpServerMock.mockClear();
    });

    describe("newSession()", () => {
      it("returns BackendState with current model + effort options from the cached catalog", async () => {
        const proc = makeProc();

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
        const ids = resp.state.model?.availableModels.map((m) => m.baseModelId);
        expect(ids).toContain("claude-fake-pro");
        expect(ids).toContain("claude-fake-mini");
        const pro = resp.state.model?.availableModels.find(
          (m) => m.baseModelId === "claude-fake-pro"
        );
        expect(pro?.effortOptions.map((o) => o.value)).toEqual(["low", "medium", "high"]);
        expect(pro?.description).toBe("test");
      });

      it("honors persisted default model when it appears in the catalog", async () => {
        const proc = makeProc({ getDefaultModelId: () => "claude-fake-mini" });

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-mini");
        const miniEffort = resp.state.model?.availableModels.find(
          (m) => m.baseModelId === "claude-fake-mini"
        )?.effortOptions;
        expect(miniEffort).toEqual([]);
      });

      it("falls back to catalog default when the default model is gone", async () => {
        const proc = makeProc({ getDefaultModelId: () => "claude-removed-by-cli-upgrade" });

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 sends the initialized model and lowest effort on the first prompt", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        const call = promptCalls[0][0] as { options: { model?: string; effort?: string } };
        expect(call.options.model).toBe("claude-fake-pro");
        expect(call.options.effort).toBe("low");
      });

      it("does not open a session when Claude Code is unsupported", async () => {
        const checkCompatibility = jest
          .fn()
          .mockRejectedValue(new Error("Claude Code 2.1.205 is not supported"));
        const proc = makeProc({ checkCompatibility });

        await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow(
          "Claude Code 2.1.205 is not supported"
        );
        expect(queryMock).not.toHaveBeenCalled();
      });

      it("shares a successful compatibility check across sessions", async () => {
        const checkCompatibility = jest.fn().mockResolvedValue(undefined);
        const proc = makeProc({ checkCompatibility });

        await Promise.all([
          proc.newSession({ cwd: "/vault-a" }),
          proc.newSession({ cwd: "/vault-b" }),
        ]);

        expect(checkCompatibility).toHaveBeenCalledTimes(1);
      });

      it("retries compatibility after a failed check", async () => {
        const checkCompatibility = jest
          .fn()
          .mockRejectedValueOnce(new Error("upgrade required"))
          .mockResolvedValueOnce(undefined);
        const proc = makeProc({ checkCompatibility });

        await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow("upgrade required");
        await expect(proc.newSession({ cwd: "/vault" })).resolves.toBeDefined();
        expect(checkCompatibility).toHaveBeenCalledTimes(2);
      });

      it("threads the backend's env overrides into the probe on a cold cache", async () => {
        (getCachedSdkCatalog as jest.Mock).mockReturnValue(undefined);
        const initializationResult = jest.fn().mockResolvedValue({ models: FAKE_CATALOG });
        queryMock.mockReturnValue({
          initializationResult,
          interrupt: jest.fn().mockResolvedValue(undefined),
        });

        const proc = makeProc({ getEnvOverrides: () => ({ ANTHROPIC_MODEL: "claude-fable-5" }) });

        await proc.newSession({ cwd: "/vault" });

        const probeCall = queryMock.mock.calls[0][0] as {
          options: { pathToClaudeCodeExecutable: string; env?: Record<string, string> };
        };
        expect(probeCall.options.env).toEqual({
          ...process.env,
          ANTHROPIC_MODEL: "claude-fable-5",
        });
      });
    });

    describe("prompt()", () => {
      it("emits SDK text deltas as agent_message_chunk events and resolves with end_turn", async () => {
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
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const events = registerCollector(proc, sessionId);

        const resp = await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        expect(resp.stopReason).toBe("end_turn");
        expect(events.map((e) => e.update)).toEqual([
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
        ]);
      });

      it("attaches Copilot's MCP servers over HTTP and pre-approves their tools on every turn", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({
          cwd: "/vault",
          mcpServers: [
            {
              name: "obsidian-copilot",
              url: "http://127.0.0.1:4100/mcp",
              headers: { Authorization: "Bearer t0k3n" },
            },
          ],
        });

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.mcpServers).toEqual({
          "obsidian-copilot": {
            type: "http",
            url: "http://127.0.0.1:4100/mcp",
            headers: { Authorization: "Bearer t0k3n" },
          },
        });
        expect(options.allowedTools).toEqual([
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "LS",
          "mcp__obsidian-copilot",
        ]);
      });

      it("starts the first query with the claude_code preset, tool allow and deny lists, the foreground hook, and a fresh session id", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        const { options } = promptCalls[0][0] as { options: Record<string, unknown> };
        expect(options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
        expect(options.mcpServers).toBeUndefined();
        expect(options.allowedTools).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "LS"]);
        expect(options.disallowedTools).toEqual(["TaskOutput", "Workflow", "Monitor"]);
        expect(options.hooks).toEqual({ PreToolUse: [{ hooks: [enforceForegroundToolUse] }] });
        expect(options.sessionId).toBe(sessionId);
        expect(options.resume).toBeUndefined();
        expect(options.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: undefined,
        });
      });

      it("forwards the composed system prompt via systemPrompt append on the claude_code preset", async () => {
        queryMock.mockImplementation(() =>
          makeQuery([streamEvent({ type: "message_start", message: {} }), resultMessage()])
        );

        const proc = makeProc({ getSystemPromptAppend: () => "DO THIS THING WITH SKILLS" });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const calls = getPromptQueryCalls();
        const opts = (calls[0][0] as { options: Record<string, unknown> }).options;
        expect(opts.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: "DO THIS THING WITH SKILLS",
        });
      });

      it("captures the system prompt at newSession time and ignores later setting changes mid-session", async () => {
        queryMock.mockImplementation(() =>
          makeQuery([streamEvent({ type: "message_start", message: {} }), resultMessage()])
        );

        let current = "FIRST DIRECTIVE";
        const proc = makeProc({ getSystemPromptAppend: () => current });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        current = "SECOND DIRECTIVE";
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const opts = (getPromptQueryCalls()[0][0] as { options: Record<string, unknown> }).options;
        expect(opts.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: "FIRST DIRECTIVE",
        });
      });

      it("passes resume on the second prompt for the same session", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));

        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(2);
        const second = promptCalls[1][0] as { options: Record<string, unknown> };
        expect(second.options.resume).toBe(sessionId);
        expect(second.options.sessionId).toBeUndefined();
      });

      it("disables thinking when the extended-thinking toggle is off", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc({ getEnableThinking: () => false });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
        expect(call.options.thinking).toEqual({ type: "disabled" });
      });

      it("requests summarized adaptive thinking when the toggle is on", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc({ getEnableThinking: () => true });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
        expect(call.options.thinking).toEqual({ type: "adaptive", display: "summarized" });
      });

      it("preserves background task identity across prompt queries", async () => {
        queryMock
          .mockImplementationOnce(() =>
            makeQuery([
              streamEvent({
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "tu-launch", name: "Agent", input: {} },
              }),
              {
                type: "user",
                tool_use_result: {
                  isAsync: true,
                  status: "async_launched",
                  agentId: "task-a",
                },
                message: {
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: "tu-launch",
                      content: "Async agent launched successfully.",
                    },
                  ],
                },
                parent_tool_use_id: null,
                session_id: "irrelevant",
              } as unknown as SDKMessage,
              resultMessage(),
            ])
          )
          .mockImplementationOnce(() =>
            makeQuery([
              {
                type: "system",
                subtype: "task_notification",
                task_id: "task-a",
                status: "completed",
                summary: "late report",
              } as unknown as SDKMessage,
              resultMessage(),
            ])
          );

        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const events: SessionEvent[] = [];
        proc.registerSessionHandler(sessionId, (event) => events.push(event));

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "start" }] });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "continue" }] });

        expect(events).toContainEqual({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tu-launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "late report" } }],
          },
        });
      });

      it("keeps concurrent query actions bound to their owning sessions after either query finishes for https://github.com/logancyang/obsidian-copilot/issues/2948", async () => {
        const queryA = makeControlledQuery();
        const queryB = makeControlledQuery();
        queryMock.mockReturnValueOnce(queryA.query).mockReturnValueOnce(queryB.query);
        const proc = makeProc();
        const { sessionId: sessionA } = await proc.newSession({ cwd: "/vault/a" });
        const { sessionId: sessionB } = await proc.newSession({ cwd: "/vault/b" });
        proc.registerSessionHandler(sessionA, () => {});
        proc.registerSessionHandler(sessionB, () => {});
        const permissionPrompter = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        const questionPrompter = jest.fn(async () => ({ "Continue?": "Yes" }));
        proc.setPermissionPrompter(permissionPrompter);
        proc.setAskUserQuestionPrompter(questionPrompter);

        const turnA = proc.prompt({ sessionId: sessionA, prompt: [{ type: "text", text: "A" }] });
        const turnB = proc.prompt({ sessionId: sessionB, prompt: [{ type: "text", text: "B" }] });
        await flushMicrotasks();
        expect(getPromptQueryCalls()).toHaveLength(2);
        const [callA, callB] = getPromptQueryCalls().map(
          (call) => (call[0] as { options: { canUseTool: CanUseTool } }).options.canUseTool
        );

        await callA("Edit", { file_path: "/vault/a/note.md" }, {
          signal: new AbortController().signal,
          toolUseID: "tool-a",
        } as never);
        expect(permissionPrompter).toHaveBeenLastCalledWith(
          expect.objectContaining({ sessionId: sessionA })
        );

        queryA.finish();
        await turnA;
        await callB(
          "AskUserQuestion",
          { questions: [{ question: "Continue?", options: [{ label: "Yes" }] }] },
          { signal: new AbortController().signal, toolUseID: "tool-b" } as never
        );
        expect(questionPrompter).toHaveBeenLastCalledWith(
          expect.objectContaining({ sessionId: sessionB, requestId: "tool-b" })
        );

        queryB.finish();
        await turnB;
      });

      it("rejects with Claude's reset message when a success-shaped result reports usage exhaustion", async () => {
        queryMock.mockImplementation(() => makeQuery(usageLimitMessages()));

        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        await expect(
          proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] })
        ).rejects.toThrow(new Error(USAGE_LIMIT_MESSAGE));
      });

      it("does not start a query when its session closes during environment preparation https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        let finishEnvironment!: (env: Record<string, string>) => void;
        const environment = new Promise<Record<string, string>>((resolve) => {
          finishEnvironment = resolve;
        });
        const backend = makeProc({ getManagedEnv: () => environment });
        const { sessionId } = await backend.newSession({ cwd: "/vault" });
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const pending = backend.prompt({ sessionId, prompt: [] });
        await flushMicrotasks();
        await backend.closeSession({ sessionId });
        finishEnvironment({});
        await expect(pending).resolves.toEqual({ stopReason: "cancelled" });
        expect(getPromptQueryCalls()).toHaveLength(0);
      });

      describe("authentication", () => {
        it("rejects with AuthRequiredError and never spawns query when not signed in", async () => {
          queryMock.mockImplementation(() => makeQuery([resultMessage()]));
          const checkAuth = jest.fn().mockResolvedValue(false);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          await expect(
            proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] })
          ).rejects.toBeInstanceOf(AuthRequiredError);
          expect(getPromptQueryCalls()).toHaveLength(0);
        });

        it("checks auth only once across turns once signed in (cached)", async () => {
          queryMock.mockImplementation(() => makeQuery([resultMessage()]));
          const checkAuth = jest.fn().mockResolvedValue(true);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
          await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });

          expect(checkAuth).toHaveBeenCalledTimes(1);
          expect(getPromptQueryCalls()).toHaveLength(2);
        });

        it("re-checks auth on the next turn when a turn ends non-success with no errors", async () => {
          const checkAuth = jest.fn().mockResolvedValue(true);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          queryMock.mockImplementationOnce(() => makeQuery([errorResultMessage([])]));
          await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
          expect(checkAuth).toHaveBeenCalledTimes(1);

          queryMock.mockImplementationOnce(() => makeQuery([resultMessage()]));
          await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });
          expect(checkAuth).toHaveBeenCalledTimes(2);
        });
      });

      describe("stream stall watchdog", () => {
        function makeStallingQuery(arg: unknown) {
          const { options } = arg as { options: { abortController: AbortController } };
          const { signal } = options.abortController;
          const iter = (async function* () {
            yield streamEvent({ type: "message_start", message: {} });
            yield streamEvent({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Draf" },
            });
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
          })();
          return Object.assign(iter, {
            interrupt: jest.fn().mockResolvedValue(undefined),
            setModel: jest.fn().mockResolvedValue(undefined),
            setPermissionMode: jest.fn().mockResolvedValue(undefined),
          });
        }

        it("aborts the turn and rejects when the stream stalls mid-message", async () => {
          queryMock.mockImplementation((arg: unknown) => makeStallingQuery(arg));
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          jest.useFakeTimers();
          try {
            const turn = proc.prompt({
              sessionId,
              prompt: [{ type: "text", text: "draft a plan" }],
            });
            const assertion = expect(turn).rejects.toThrow(/stalled/i);
            await jest.advanceTimersByTimeAsync(61_000);
            await assertion;
          } finally {
            jest.useRealTimers();
          }
          const call = getPromptQueryCalls()[0][0] as {
            options: { abortController: AbortController };
          };
          expect(call.options.abortController.signal.aborted).toBe(true);
        });
      });

      describe("plan usage", () => {
        it("publishes a reading to every live session, not only the one that took the turn", async () => {
          const proc = makeProc();
          const first = await proc.newSession({ cwd: "/vault" });
          const second = await proc.newSession({ cwd: "/vault" });
          const firstEvents = registerCollector(proc, first.sessionId);
          const secondEvents = registerCollector(proc, second.sessionId);

          await promptReportingPlanUsage(proc, first.sessionId, async () => WEEKLY_21_PERCENT);

          for (const events of [firstEvents, secondEvents]) {
            expect(planUsageUpdates(events)).toMatchObject([
              {
                sessionUpdate: "plan_usage_update",
                planUsage: { windows: [{ id: "seven_day", percent: 21 }] },
              },
            ]);
          }
        });

        it("clears the meters when the account turns out not to be metered by plan caps (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const events = registerCollector(proc, sessionId);
          await promptReportingPlanUsage(proc, sessionId, async () => WEEKLY_21_PERCENT);

          await promptReportingPlanUsage(proc, sessionId, async () => ({
            rate_limits_available: false,
          }));

          expect(planUsageUpdates(events).at(-1)).toEqual({
            sessionUpdate: "plan_usage_update",
            planUsage: null,
          });
        });

        it("keeps showing the last good reading when the usage call fails", async () => {
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const events = registerCollector(proc, sessionId);
          await promptReportingPlanUsage(proc, sessionId, async () => WEEKLY_21_PERCENT);
          const publishedBefore = planUsageUpdates(events).length;

          await promptReportingPlanUsage(proc, sessionId, () =>
            Promise.reject(new Error("transport closed"))
          );

          expect(planUsageUpdates(events)).toHaveLength(publishedBefore);
          const later = await proc.newSession({ cwd: "/vault" });
          expect(planUsageUpdates(registerCollector(proc, later.sessionId))).toMatchObject([
            { planUsage: { windows: [{ id: "seven_day", percent: 21 }] } },
          ]);
        });
      });
    });

    describe("registerSessionHandler()", () => {
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

        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const promptPromise = proc.prompt({
          sessionId,
          prompt: [{ type: "text", text: "hi" }],
        });

        const seen: SessionEvent[] = [];
        proc.registerSessionHandler(sessionId, (e) => seen.push(e));
        await promptPromise;

        expect(seen.map((e) => e.update)).toContainEqual({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "buffered" },
        });
      });

      it("replays the last read plan caps to a session registered afterwards", async () => {
        const proc = makeProc();
        const first = await proc.newSession({ cwd: "/vault" });
        registerCollector(proc, first.sessionId);
        await promptReportingPlanUsage(proc, first.sessionId, async () => WEEKLY_21_PERCENT);
        const second = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, second.sessionId);

        expect(planUsageUpdates(events)).toMatchObject([
          {
            sessionUpdate: "plan_usage_update",
            planUsage: { windows: [{ id: "seven_day", label: "Weekly", percent: 21 }] },
          },
        ]);
      });

      it("sends no plan caps to a session registered before any were read", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, sessionId);

        expect(planUsageUpdates(events)).toEqual([]);
      });

      it("does not replay a plan window whose reset has already passed (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
        const proc = makeProc();
        const first = await proc.newSession({ cwd: "/vault" });
        registerCollector(proc, first.sessionId);
        await promptReportingPlanUsage(proc, first.sessionId, async () => ({
          rate_limits_available: true,
          rate_limits: {
            five_hour: {
              utilization: 88,
              resets_at: new Date(Date.now() - 60_000).toISOString(),
            },
            seven_day: {
              utilization: 21,
              resets_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
          },
        }));
        const second = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, second.sessionId);

        expect(planUsageUpdates(events)).toMatchObject([
          { planUsage: { windows: [{ id: "seven_day" }] } },
        ]);
      });
    });

    describe("setSessionConfigOption()", () => {
      it("sets the effort level on the session state and sends it with the next prompt", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
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

      it("rejects an effort level the session's model does not support", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await expect(
          proc.setSessionConfigOption({ sessionId, configId: "effort", value: "max" })
        ).rejects.toThrow("Effort 'max' not supported by claude-fake-pro");
      });
    });

    describe("setSessionMode()", () => {
      it.each(["default", "plan", "acceptEdits", "auto", "bypassPermissions"])(
        "carries the %s permission mode into the next turn",
        async (modeId) => {
          queryMock.mockImplementation(() => makeQuery([resultMessage()]));
          const proc = makeProc();

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});
          await proc.setSessionMode({ sessionId, modeId });
          await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

          const call = getPromptQueryCalls()[0][0] as { options: { permissionMode?: string } };
          expect(call.options.permissionMode).toBe(modeId);
        }
      );

      it("rejects a permission mode the SDK does not define", async () => {
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await expect(proc.setSessionMode({ sessionId, modeId: "dontAsk" })).rejects.toThrow(
          "Unsupported mode dontAsk"
        );
      });
    });

    describe("closeSession()", () => {
      it("terminates only the closing session's active query https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const backend = makeProc();
        const first = await backend.newSession({ cwd: "/vault" });
        const sibling = await backend.newSession({ cwd: "/vault" });
        const a = makeControlledQuery();
        const b = makeControlledQuery();
        const closeA = jest.fn(a.finish);
        const closeB = jest.fn(b.finish);
        queryMock
          .mockReset()
          .mockReturnValueOnce(Object.assign(a.query, { close: closeA }))
          .mockReturnValueOnce(Object.assign(b.query, { close: closeB }));
        const pendingA = backend.prompt({ sessionId: first.sessionId, prompt: [] });
        const pendingB = backend.prompt({ sessionId: sibling.sessionId, prompt: [] });
        await flushMicrotasks();
        await backend.closeSession({ sessionId: first.sessionId });
        expect(closeA).toHaveBeenCalledTimes(1);
        expect(closeB).not.toHaveBeenCalled();
        b.finish();
        await Promise.all([pendingA, pendingB]);
        await expect(backend.prompt({ sessionId: first.sessionId, prompt: [] })).rejects.toThrow(
          "Unknown session"
        );
      });
    });

    describe("supportsAdditionalDirectories()", () => {
      it("reports support for additionalDirectories (stable SDK option)", () => {
        expect(makeProc().supportsAdditionalDirectories()).toBe(true);
      });

      it("forwards captured additionalDirectories into options on every turn", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({
          cwd: "/vault",
          additionalDirectories: ["/abs/context-a", "/abs/context-b"],
        });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as {
          options: { additionalDirectories?: string[] };
        };
        expect(call.options.additionalDirectories).toEqual(["/abs/context-a", "/abs/context-b"]);
      });

      it("omits additionalDirectories from options when none were captured", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as {
          options: { additionalDirectories?: string[] };
        };
        expect(call.options.additionalDirectories).toBeUndefined();
      });
    });

    describe("resumeSession()", () => {
      it("reopens the session with the seeded model state and sends its next prompt as a resume, replaying nothing", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProc();
        const sessionId = "resumed-session";
        const events = registerCollector(proc, sessionId);

        const resp = await proc.resumeSession({ sessionId, cwd: "/vault" });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "continue" }] });

        expect(resp.sessionId).toBe(sessionId);
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
        expect(events).toEqual([]);
        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.resume).toBe(sessionId);
        expect(options.sessionId).toBeUndefined();
      });
    });

    describe("loadSession()", () => {
      const ISSUE_643 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/643";
      const cwd = "/vault";
      const sessionId = "11111111-2222-3333-4444-555555555555";
      let configDir: string;

      beforeEach(async () => {
        configDir = await mkdtemp(path.join(os.tmpdir(), "claude-config-"));
      });
      afterEach(async () => {
        await rm(configDir, { recursive: true, force: true });
      });

      function makeProcWithConfigDir(): ClaudeSdkBackendProcess {
        return makeProc({ getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: configDir }) });
      }

      async function writeTranscript(...entries: object[]): Promise<void> {
        const dir = path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${sessionId}.jsonl`),
          entries.map((entry) => `${JSON.stringify(entry)}\n`).join("")
        );
      }

      it("delivers the transcript's prompt, thinking, reply, and tool call with its result to the session handler, in order, before it resolves", async () => {
        await writeTranscript(
          { type: "user", uuid: "u-1", message: { role: "user", content: "rename the note" } },
          {
            type: "assistant",
            message: { role: "assistant", content: [{ type: "thinking", thinking: "Use mv." }] },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "tool-mv",
                  name: "Bash",
                  input: { command: "mv a.md b.md" },
                },
              ],
            },
          },
          {
            type: "user",
            uuid: "u-2",
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "tool-mv", content: "" }],
            },
          },
          {
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "Renamed." }] },
          }
        );
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);

        const deliveredAtResolve = await proc
          .loadSession({ sessionId, cwd })
          .then(() => events.map((e) => [e.update.sessionUpdate, e.sessionId]));

        expect(deliveredAtResolve).toEqual([
          ["user_message_chunk", sessionId],
          ["agent_thought_chunk", sessionId],
          ["tool_call", sessionId],
          ["tool_call_update", sessionId],
          ["agent_message_chunk", sessionId],
        ]);
        expect(events[3].update).toMatchObject({ toolCallId: "tool-mv", status: "completed" });
      });

      it("returns the same session id and model state resumeSession returns and sends its next prompt as a resume", async () => {
        await writeTranscript({ type: "user", uuid: "u-1", message: { content: "hello" } });
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const resumed = await makeProcWithConfigDir().resumeSession({ sessionId, cwd });
        const proc = makeProcWithConfigDir();
        registerCollector(proc, sessionId);

        const loaded = await proc.loadSession({ sessionId, cwd });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "continue" }] });

        expect(loaded).toEqual(resumed);
        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.resume).toBe(sessionId);
      });

      it("carries the replayed task list into the next live turn so a TaskUpdate updates a task created before reopening", async () => {
        await writeTranscript(
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "create-1",
                  name: "TaskCreate",
                  input: { subject: "Collect sources" },
                },
              ],
            },
          },
          {
            type: "user",
            uuid: "u-1",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "create-1",
                  content: "Task #1 created successfully: Collect sources",
                },
              ],
            },
          }
        );
        queryMock.mockImplementation(() =>
          makeQuery([
            streamEvent({ type: "message_start", message: {} }),
            streamEvent({
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: "update-1",
                name: "TaskUpdate",
                input: { taskId: "1", status: "completed" },
              },
            }),
            resultMessage(),
          ])
        );
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);
        await proc.loadSession({ sessionId, cwd });
        events.length = 0;

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "mark it done" }] });

        expect(events.map((e) => e.update)).toContainEqual({
          sessionUpdate: "plan",
          entries: [{ content: "Collect sources", status: "completed", priority: "medium" }],
        });
      });

      it(`reopens the session with no replayed history when its transcript is missing (${ISSUE_643})`, async () => {
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);

        const loaded = await proc.loadSession({ sessionId, cwd });

        expect(loaded.sessionId).toBe(sessionId);
        expect(loaded.state.model?.current.baseModelId).toBe("claude-fake-pro");
        expect(events).toEqual([]);
      });
    });

    describe("sessionExistsLocally()", () => {
      const cwd = "/vault";
      const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
      let configDir: string;

      beforeEach(async () => {
        configDir = await mkdtemp(path.join(os.tmpdir(), "claude-config-"));
      });
      afterEach(async () => {
        await rm(configDir, { recursive: true, force: true });
      });

      function makeProcWithConfigDir(): ClaudeSdkBackendProcess {
        return makeProc({ getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: configDir }) });
      }

      it("returns true when this device has the session transcript on disk", async () => {
        const sessionId = "11111111-2222-3333-4444-555555555555";
        const dir = path.join(configDir, "projects", projectDir);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${sessionId}.jsonl`), "{}\n");

        await expect(
          makeProcWithConfigDir().sessionExistsLocally({ sessionId, cwd })
        ).resolves.toBe(true);
      });

      it("returns false for a session whose transcript never synced to this device", async () => {
        await expect(
          makeProcWithConfigDir().sessionExistsLocally({ sessionId: "absent-session-id", cwd })
        ).resolves.toBe(false);
      });
    });
  });
});
