import type { HookCallback, ModelInfo, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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

  describe("prompt()", () => {
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

      const { sessionId, state } = await proc.newSession({ cwd: "/vault" });
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
      expect(call.options.mcpServers).toBeUndefined();
      expect(call.options.allowedTools).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "LS"]);
      expect(call.options.disallowedTools).toEqual(["TaskOutput", "Workflow", "Monitor"]);
      expect(call.options.hooks).toEqual({
        PreToolUse: [{ hooks: [enforceForegroundToolUse] }],
      });
      expect((call.options.hooks as Record<string, unknown>).Stop).toBeUndefined();
      // First turn → sessionId is seeded, no resume.
      expect(call.options.sessionId).toBe(sessionId);
      expect(call.options.resume).toBeUndefined();
      // No append configured, but the preset is still pinned to its cacheable form.
      expect(call.options.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
        excludeDynamicSections: true,
        append: undefined,
      });
    });

    it("rejects with Claude's reset message when a success-shaped result reports usage exhaustion", async () => {
      queryMock.mockImplementation(() => makeQuery(usageLimitMessages()));

      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      proc.registerSessionHandler(sessionId, () => {});

      await expect(
        proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] })
      ).rejects.toThrow(new Error(USAGE_LIMIT_MESSAGE));
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

      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });
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

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

      const calls = getPromptQueryCalls();
      const opts = (calls[0][0] as { options: Record<string, unknown> }).options;
      expect(opts.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
        // Keeps cwd, git status and memory paths out of the cached system prefix.
        excludeDynamicSections: true,
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

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      // Mutate the "setting" after newSession → the session's first turn must
      // still use the original prompt, proving capture-at-newSession semantics.
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

    // The SDK adapter's contract is "forward `getSystemPromptAppend()` verbatim
    // into `options.systemPrompt.append`", proven above. The Claude descriptor
    // wires that callback to `buildAgentSystemPrompt`, whose composition — the
    // Copilot base prompt, pill directive, tool guidance, and disable-builtin
    // behavior — is unit-tested in
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

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
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

    describe("authentication", () => {
      function makeAuthCheckedProcess(checkAuth: jest.Mock) {
        return new ClaudeSdkBackendProcess({
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          app: { vault: {} } as any,
          clientVersion: "1.2.3",
          descriptor: fakeDescriptor(),
          checkAuth,
        });
      }

      it("rejects with AuthRequiredError and never spawns query when not signed in", async () => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const checkAuth = jest.fn().mockResolvedValue(false);
        const proc = makeAuthCheckedProcess(checkAuth);

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
        const proc = makeAuthCheckedProcess(checkAuth);

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });

        expect(checkAuth).toHaveBeenCalledTimes(1);
        expect(getPromptQueryCalls()).toHaveLength(2);
      });

      it("re-checks auth on the next turn when a turn ends non-success with no errors", async () => {
        const checkAuth = jest.fn().mockResolvedValue(true);
        const proc = makeAuthCheckedProcess(checkAuth);

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        // First turn ends with a non-success result carrying no error detail
        // (the "saved login expired" shape) → cache is invalidated.
        queryMock.mockImplementationOnce(() => makeQuery([errorResultMessage([])]));
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "1" }] });
        expect(checkAuth).toHaveBeenCalledTimes(1);

        queryMock.mockImplementationOnce(() => makeQuery([resultMessage()]));
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "2" }] });
        expect(checkAuth).toHaveBeenCalledTimes(2);
      });
    });

    describe("stream stall watchdog", () => {
      function makeProcess() {
        return new ClaudeSdkBackendProcess({
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          app: { vault: {} } as any,
          clientVersion: "1.2.3",
          descriptor: fakeDescriptor(),
        });
      }

      /**
       * A query whose stream emits a couple of mid-message deltas (arming the
       * watchdog) and then goes silent forever — until the backend's abort
       * controller fires, at which point the generator returns (the SDK "stops and
       * cleans up"). Reproduces a dropped/half-open response with no terminal
       * `result`, which would otherwise park `for await` and wedge the turn.
       */
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
        const proc = makeProcess();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        jest.useFakeTimers();
        try {
          const turn = proc.prompt({ sessionId, prompt: [{ type: "text", text: "draft a plan" }] });
          // The thrown stall error is what `AgentSession` renders as the in-chat
          // turn error via `markMessageError`.
          const assertion = expect(turn).rejects.toThrow(/stalled/i);
          // Past the idle window; advanceTimersByTimeAsync flushes microtasks so the
          // two deltas are consumed and the watchdog timer fires.
          await jest.advanceTimersByTimeAsync(61_000);
          await assertion;
        } finally {
          jest.useRealTimers();
        }
        // The query was aborted (not left dangling) so the turn can be retried.
        const call = getPromptQueryCalls()[0][0] as {
          options: { abortController: AbortController };
        };
        expect(call.options.abortController.signal.aborted).toBe(true);
      });

      it("passes an abort controller to query() and never fires while the stream is healthy", async () => {
        queryMock.mockImplementation(() =>
          makeQuery([
            streamEvent({ type: "message_start", message: {} }),
            streamEvent({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "ok" },
            }),
            streamEvent({ type: "message_stop" }),
            resultMessage(),
          ])
        );
        const proc = makeProcess();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});

        const resp = await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });
        expect(resp.stopReason).toBe("end_turn");
        const call = getPromptQueryCalls()[0][0] as { options: { abortController?: unknown } };
        expect(call.options.abortController).toBeInstanceOf(AbortController);
      });
    });
  });

  describe("newSession()", () => {
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

      const resp = await proc.newSession({ cwd: "/vault" });
      expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
      const ids = resp.state.model?.availableModels.map((m) => m.baseModelId);
      expect(ids).toContain("claude-fake-pro");
      expect(ids).toContain("claude-fake-mini");
      const pro = resp.state.model?.availableModels.find(
        (m) => m.baseModelId === "claude-fake-pro"
      );
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

      const resp = await proc.newSession({ cwd: "/vault" });
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

      const resp = await proc.newSession({ cwd: "/vault" });
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

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
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

    it("disables thinking when the extended-thinking toggle is off", async () => {
      queryMock.mockImplementation(() => makeQuery([resultMessage()]));
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        getEnableThinking: () => false,
      });

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      proc.registerSessionHandler(sessionId, () => {});
      await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

      const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
      expect(call.options.thinking).toEqual({ type: "disabled" });
    });

    it("requests summarized adaptive thinking when the toggle is on", async () => {
      queryMock.mockImplementation(() => makeQuery([resultMessage()]));
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        getEnableThinking: () => true,
      });

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      proc.registerSessionHandler(sessionId, () => {});
      await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

      const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
      expect(call.options.thinking).toEqual({ type: "adaptive", display: "summarized" });
    });

    it("does not open a session when Claude Code is unsupported", async () => {
      const checkCompatibility = jest
        .fn()
        .mockRejectedValue(new Error("Claude Code 2.1.205 is not supported"));
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        checkCompatibility,
      });

      await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow(
        "Claude Code 2.1.205 is not supported"
      );
      expect(queryMock).not.toHaveBeenCalled();
    });

    it("shares a successful compatibility check across sessions", async () => {
      const checkCompatibility = jest.fn().mockResolvedValue(undefined);
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        checkCompatibility,
      });

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
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        checkCompatibility,
      });

      await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow("upgrade required");
      await expect(proc.newSession({ cwd: "/vault" })).resolves.toBeDefined();
      expect(checkCompatibility).toHaveBeenCalledTimes(2);
    });

    it("threads the backend's env overrides into the probe on a cold cache", async () => {
      // Cold module cache forces a real probe; the SDK reflects ANTHROPIC_MODEL
      // into init.models itself, so the env just has to reach the probe.
      (getCachedSdkCatalog as jest.Mock).mockReturnValue(undefined);
      const initializationResult = jest.fn().mockResolvedValue({ models: FAKE_CATALOG });
      queryMock.mockReturnValue({
        initializationResult,
        interrupt: jest.fn().mockResolvedValue(undefined),
      });

      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        getEnvOverrides: () => ({ ANTHROPIC_MODEL: "claude-fable-5" }),
      });

      await proc.newSession({ cwd: "/vault" });

      const probeCall = queryMock.mock.calls[0][0] as {
        options: { pathToClaudeCodeExecutable: string; env?: Record<string, string> };
      };
      expect(probeCall.options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
      expect(probeCall.options.env?.ANTHROPIC_MODEL).toBe("claude-fable-5");
      // Child env is process.env plus the overrides, not a bare override map.
      expect(probeCall.options.env?.PATH).toBe(process.env.PATH);
    });
  });

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

  describe("setSessionMode()", () => {
    beforeEach(() => {
      queryMock.mockReset();
      createSdkMcpServerMock.mockClear();
    });

    function makeProcess(): ClaudeSdkBackendProcess {
      return new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });
    }

    it.each(["default", "plan", "acceptEdits", "auto", "bypassPermissions"])(
      "carries the %s permission mode into the next turn",
      async (modeId) => {
        queryMock.mockImplementation(() => makeQuery([resultMessage()]));
        const proc = makeProcess();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await proc.setSessionMode({ sessionId, modeId });
        await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as { options: { permissionMode?: string } };
        expect(call.options.permissionMode).toBe(modeId);
      }
    );

    it("rejects a permission mode the SDK does not define", async () => {
      const proc = makeProcess();

      const { sessionId } = await proc.newSession({ cwd: "/vault" });

      await expect(proc.setSessionMode({ sessionId, modeId: "dontAsk" })).rejects.toThrow(
        "Unsupported mode dontAsk"
      );
    });
  });

  describe("supportsAdditionalDirectories()", () => {
    beforeEach(() => {
      queryMock.mockReset();
      createSdkMcpServerMock.mockClear();
    });

    function makeProc() {
      return new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });
    }

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

      const call = getPromptQueryCalls()[0][0] as { options: { additionalDirectories?: string[] } };
      expect(call.options.additionalDirectories).toEqual(["/abs/context-a", "/abs/context-b"]);
    });

    it("omits additionalDirectories from options when none were captured", async () => {
      queryMock.mockImplementation(() => makeQuery([resultMessage()]));
      const proc = makeProc();

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      proc.registerSessionHandler(sessionId, () => {});
      await proc.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] });

      const call = getPromptQueryCalls()[0][0] as { options: { additionalDirectories?: string[] } };
      expect(call.options.additionalDirectories).toBeUndefined();
    });
  });

  describe("sessionExistsLocally()", () => {
    const cwd = "/vault";
    // Mirrors the CLI's project-dir encoding: non-alphanumerics → "-".
    const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    let configDir: string;

    beforeEach(async () => {
      configDir = await mkdtemp(path.join(os.tmpdir(), "claude-config-"));
    });
    afterEach(async () => {
      await rm(configDir, { recursive: true, force: true });
    });

    function makeProc(): ClaudeSdkBackendProcess {
      return new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
        getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: configDir }),
      });
    }

    it("returns true when this device has the session transcript on disk", async () => {
      const sessionId = "11111111-2222-3333-4444-555555555555";
      const dir = path.join(configDir, "projects", projectDir);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${sessionId}.jsonl`), "{}\n");

      await expect(makeProc().sessionExistsLocally({ sessionId, cwd })).resolves.toBe(true);
    });

    it("returns false for a session whose transcript never synced to this device", async () => {
      await expect(
        makeProc().sessionExistsLocally({ sessionId: "absent-session-id", cwd })
      ).resolves.toBe(false);
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

  describe("plan usage", () => {
    it("replays the last known caps to a newly attached session", async () => {
      // The caps belong to the account, not the conversation. Without this, opening or
      // switching to another chat showed no caps until that chat had taken its own turn,
      // which reads as the meters having vanished.
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });

      const planUsage = {
        windows: [{ id: "seven_day", label: "Weekly", percent: 21 }],
        updatedAt: 1,
      };
      // Stand in for a read that already happened on an earlier session.
      (proc as unknown as { lastPlanUsage: unknown }).lastPlanUsage = planUsage;

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const events: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (e) => events.push(e));

      expect(events).toContainEqual({
        sessionId,
        update: { sessionUpdate: "plan_usage_update", planUsage },
      });
    });

    it("sends no caps to a new session before any have been read", async () => {
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const events: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (e) => events.push(e));

      expect(events.some((e) => e.update.sessionUpdate === "plan_usage_update")).toBe(false);
    });

    it("does not replay a window whose reset has already passed (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // This process outlives many chats. Replaying a snapshot taken before a reset shows
      // the previous period's percentage as if it described the current one.
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });

      (proc as unknown as { lastPlanUsage: unknown }).lastPlanUsage = {
        windows: [
          { id: "five_hour", label: "5h", percent: 88, resetsAt: Date.now() - 1_000 },
          { id: "seven_day", label: "Weekly", percent: 21, resetsAt: Date.now() + 60_000 },
        ],
        updatedAt: 1,
      };

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const events: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (e) => events.push(e));

      const replayed = events.find((e) => e.update.sessionUpdate === "plan_usage_update");
      expect(replayed?.update).toMatchObject({
        planUsage: { windows: [{ id: "seven_day" }] },
      });
    });

    it("publishes a reading to every live session, not only the one that took the turn", async () => {
      // The caps describe the account, so they are equally true of every open chat.
      // Routing them to one leaves the others showing a stale number until they each run
      // a turn (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });

      const first = await proc.newSession({ cwd: "/vault" });
      const second = await proc.newSession({ cwd: "/vault" });
      const firstEvents: SessionEvent[] = [];
      const secondEvents: SessionEvent[] = [];
      proc.registerSessionHandler(first.sessionId, (e) => firstEvents.push(e));
      proc.registerSessionHandler(second.sessionId, (e) => secondEvents.push(e));

      await (
        proc as unknown as { refreshPlanUsage: (q: unknown) => Promise<void> }
      ).refreshPlanUsage({
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          Promise.resolve({
            rate_limits_available: true,
            rate_limits: { seven_day: { utilization: 21 } },
          }),
      });

      for (const events of [firstEvents, secondEvents]) {
        expect(events.filter((e) => e.update.sessionUpdate === "plan_usage_update")).toHaveLength(
          1
        );
      }
    });

    it("clears the meters when the account turns out not to be metered by plan caps (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // Switching an external Claude login from OAuth to an API key mid-session leaves
      // subscription caps on screen that no longer apply to anything.
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });
      (proc as unknown as { lastPlanUsage: unknown }).lastPlanUsage = {
        windows: [{ id: "seven_day", label: "Weekly", percent: 21 }],
        updatedAt: 1,
      };

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const events: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (e) => events.push(e));

      await (
        proc as unknown as { refreshPlanUsage: (q: unknown) => Promise<void> }
      ).refreshPlanUsage({
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          Promise.resolve({ rate_limits_available: false }),
      });

      expect(events.at(-1)?.update).toEqual({
        sessionUpdate: "plan_usage_update",
        planUsage: null,
      });
    });

    it("keeps the last good reading when the usage call fails", async () => {
      const proc = new ClaudeSdkBackendProcess({
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app: { vault: {} } as any,
        clientVersion: "1.2.3",
        descriptor: fakeDescriptor(),
      });
      const planUsage = {
        windows: [{ id: "seven_day", label: "Weekly", percent: 21 }],
        updatedAt: 1,
      };
      (proc as unknown as { lastPlanUsage: unknown }).lastPlanUsage = planUsage;

      const { sessionId } = await proc.newSession({ cwd: "/vault" });
      const events: SessionEvent[] = [];
      proc.registerSessionHandler(sessionId, (e) => events.push(e));
      events.length = 0;

      await (
        proc as unknown as { refreshPlanUsage: (q: unknown) => Promise<void> }
      ).refreshPlanUsage({
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          Promise.reject(new Error("transport closed")),
      });

      // A failed read is the absence of news, never a reason to blank a live meter.
      expect(events).toHaveLength(0);
      expect((proc as unknown as { lastPlanUsage: unknown }).lastPlanUsage).toBe(planUsage);
    });
  });
});
