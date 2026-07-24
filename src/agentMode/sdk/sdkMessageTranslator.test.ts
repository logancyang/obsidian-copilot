import fs from "fs";
import path from "path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent, SessionUpdate, SessionUsage } from "@/agentMode/session/types";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";

const SESSION_ID = "session-test-1";

interface FixtureFrame {
  tag: string;
  payload: SDKMessage;
}

function readFixture(): FixtureFrame[] {
  const fixturePath = path.join(
    __dirname,
    "__fixtures__/claude-notification-only-subagents.ndjson"
  );
  return fs
    .readFileSync(fixturePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FixtureFrame);
}
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

function streamEvent(event: object): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "uuid-1" as Uuid,
    session_id: SESSION_ID,
  } as SDKMessage;
}

interface CallUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function assistantMsg(
  usage: CallUsage,
  opts: { model?: string; parentToolUseId?: string | null } = {}
): SDKMessage {
  return {
    type: "assistant",
    message: { content: [], usage, model: opts.model ?? "claude-test" },
    parent_tool_use_id: opts.parentToolUseId ?? null,
    uuid: "uuid-assistant" as Uuid,
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

interface ModelUsageEntry {
  contextWindow: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

function resultMsg(opts: {
  usage?: CallUsage;
  modelUsage?: Record<string, ModelUsageEntry>;
  total_cost_usd?: number;
}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: opts.total_cost_usd ?? 0,
    usage: opts.usage ?? {},
    modelUsage: opts.modelUsage ?? {},
    permission_denials: [],
    uuid: "uuid-result" as Uuid,
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

function usageOf(out: ReturnType<typeof translateSdkMessage>): SessionUsage {
  return (out[0].update as { usage: SessionUsage }).usage;
}

describe("translateSdkMessage", () => {
  it("emits agent_message_chunk for text deltas", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello, world" },
      }),
      SESSION_ID,
      state
    );
    expect(out).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello, world" },
        },
      },
    ]);
  });

  it("emits agent_thought_chunk for thinking deltas", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      }),
      SESSION_ID,
      state
    );
    expect(out).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Let me think..." },
        },
      },
    ]);
  });

  it("ignores non-text deltas (input_json, signature, citations)", () => {
    const state = createTranslatorState();
    expect(
      translateSdkMessage(
        streamEvent({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"a":1}' },
        }),
        SESSION_ID,
        state
      )
    ).toEqual([]);
    expect(
      translateSdkMessage(
        streamEvent({
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        }),
        SESSION_ID,
        state
      )
    ).toEqual([]);
  });

  it("emits nothing for message_start/stop and content_block_start/stop in Chunk 1", () => {
    const state = createTranslatorState();
    expect(
      translateSdkMessage(streamEvent({ type: "message_start", message: {} }), SESSION_ID, state)
    ).toEqual([]);
    expect(translateSdkMessage(streamEvent({ type: "message_stop" }), SESSION_ID, state)).toEqual(
      []
    );
    expect(
      translateSdkMessage(
        streamEvent({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
        SESSION_ID,
        state
      )
    ).toEqual([]);
    expect(
      translateSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), SESSION_ID, state)
    ).toEqual([]);
  });

  it("clears toolUseBlocks state on message_start", () => {
    const state = createTranslatorState();
    state.toolUseBlocks.set(0, {
      id: "t1",
      name: "Tool",
      inputJsonAcc: "",
      lastParsedInput: {},
    });
    translateSdkMessage(streamEvent({ type: "message_start", message: {} }), SESSION_ID, state);
    expect(state.toolUseBlocks.size).toBe(0);
  });

  it("reports occupancy from the last assistant message, not the cumulative result total", () => {
    const state = createTranslatorState();
    // Two tool-loop iterations. The SDK result SUMS these across the turn, but
    // occupancy is only the final call's own prompt + reply.
    translateSdkMessage(
      assistantMsg({ input_tokens: 100, cache_creation_input_tokens: 10_000, output_tokens: 50 }),
      SESSION_ID,
      state
    );
    translateSdkMessage(
      assistantMsg({ input_tokens: 200, cache_read_input_tokens: 10_050, output_tokens: 80 }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      resultMsg({
        // Cumulative aggregate — deliberately larger than occupancy.
        usage: {
          input_tokens: 300,
          cache_read_input_tokens: 10_050,
          cache_creation_input_tokens: 10_000,
          output_tokens: 130,
        },
        modelUsage: { "claude-test": { contextWindow: 200_000 } },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update.sessionUpdate).toBe("usage_update");
    const usage = usageOf(out);
    // Final call: 200 + 10_050 + 0 + 80 = 10_330 (occupancy), NOT the cumulative
    // 300 + 10_050 + 10_000 + 130 = 20_480.
    expect(usage.usedTokens).toBe(10_330);
    expect(usage.contextWindow).toBe(200_000);
  });

  it("uses the active model's context window, not the largest in a multi-model turn", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      assistantMsg({ input_tokens: 1000, output_tokens: 50 }, { model: "main" }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      resultMsg({
        modelUsage: {
          // A subagent used a larger window; the ring must divide by the MAIN
          // model's window, not the max across the turn.
          main: { contextWindow: 200_000 },
          sub: { contextWindow: 1_000_000 },
        },
      }),
      SESSION_ID,
      state
    );
    expect(usageOf(out).contextWindow).toBe(200_000);
  });

  it("ignores subagent assistant usage when sampling occupancy", () => {
    const state = createTranslatorState();
    // Subagent turn (parent_tool_use_id set) — a different context; must not
    // become the occupancy sample.
    translateSdkMessage(
      assistantMsg({ input_tokens: 99_999, output_tokens: 0 }, { parentToolUseId: "t1" }),
      SESSION_ID,
      state
    );
    translateSdkMessage(
      assistantMsg({ input_tokens: 1000, output_tokens: 20 }, { model: "main" }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      resultMsg({ modelUsage: { main: { contextWindow: 200_000 } } }),
      SESSION_ID,
      state
    );
    expect(usageOf(out).usedTokens).toBe(1020);
  });

  it("emits no usage_update when the turn produced no top-level assistant message", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(resultMsg({}), SESSION_ID, state);
    expect(out).toEqual([]);
  });

  it("falls back to the dominant model's window for a synthetic assistant turn", () => {
    const state = createTranslatorState();
    // A "<synthetic>" model id keys into no modelUsage entry; the window comes
    // from the model that carried the conversation (most tokens), never an aux
    // model that happens to have a different window.
    translateSdkMessage(
      assistantMsg(
        { input_tokens: 500, cache_read_input_tokens: 4000, output_tokens: 40 },
        { model: "<synthetic>" }
      ),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      resultMsg({
        modelUsage: {
          "claude-opus-4-8[1m]": {
            contextWindow: 1_000_000,
            inputTokens: 5000,
            cacheReadInputTokens: 400_000,
            cacheCreationInputTokens: 100_000,
            outputTokens: 6000,
          },
          "claude-haiku-4-5-20251001": {
            contextWindow: 200_000,
            inputTokens: 300,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 12,
          },
        },
      }),
      SESSION_ID,
      state
    );
    expect(usageOf(out).contextWindow).toBe(1_000_000);
  });

  it("ignores assistant messages whose tool_use blocks were already streamed", () => {
    const state = createTranslatorState();
    // Pretend the streaming path already saw this tool_use.
    state.emittedToolUseIds.add("tool-1");
    expect(
      translateSdkMessage(
        {
          type: "assistant",

          message: {
            content: [
              { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.md" } },
            ],
          } as never,
          parent_tool_use_id: null,
          uuid: "uuid-a" as `${string}-${string}-${string}-${string}-${string}`,
          session_id: SESSION_ID,
        },
        SESSION_ID,
        state
      )
    ).toEqual([]);
  });

  it("emits tool_call on content_block_start for tool_use blocks", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-1", name: "Read", input: {} },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-1",
      kind: "read",
      vendorToolName: "Read",
    });
  });

  it("emits tool_call_update with parsed rawInput on input_json_delta", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-2", name: "Read", input: {} },
      }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"file_path":"a.md"}' },
      }),
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tu-2",
      rawInput: { file_path: "a.md" },
    });
  });

  it("emits tool_call_update with status in_progress on content_block_stop", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-3", name: "ExitPlanMode", input: {} },
      }),
      SESSION_ID,
      state
    );
    translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"plan":"Step 1"}' },
      }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      streamEvent({ type: "content_block_stop", index: 0 }),
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tu-3",
      rawInput: { plan: "Step 1" },
      status: "in_progress",
    });
  });

  it("emits tool_call_update with status completed for tool_result (success)", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "user",

        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-4",
              content: "vault contents",
              is_error: false,
            },
          ],
        } as never,
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tu-4",
      status: "completed",
    });
  });

  it("emits tool_call_update with status failed when tool_result.is_error is true", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "user",

        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-5", content: "boom", is_error: true }],
        } as never,
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({ status: "failed" });
  });

  it("synthesizes current_mode_update on EnterPlanMode tool_use", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-plan", name: "EnterPlanMode", input: {} },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(2);
    expect(out[0].update).toMatchObject({ sessionUpdate: "tool_call", toolCallId: "tu-plan" });
    expect(out[1].update).toMatchObject({
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
  });

  it("strips the mcp__<server>__ prefix when the server name itself contains underscores", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tu-mcp-underscored",
          name: "mcp__my_server__do_thing",
          input: {},
        },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-mcp-underscored",
      vendorToolName: "do_thing",
      mcpServer: "my_server",
    });
  });

  it("strips the mcp__<server>__ prefix from MCP tool names so kind/title/meta see the bare name", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tu-mcp",
          name: "mcp__custom-server__do_thing",
          input: { path: "Daily/2026-05-01.md" },
        },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-mcp",
      title: "do_thing Daily/2026-05-01.md",
      vendorToolName: "do_thing",
      mcpServer: "custom-server",
    });
  });

  it("emits ExitPlanMode tool_call with kind=switch_mode (routes through plan-proposal flow)", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-exit", name: "ExitPlanMode", input: {} },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-exit",
      kind: "switch_mode",
      vendorToolName: "ExitPlanMode",
      isPlanProposal: true,
    });
  });

  it("does not treat an MCP tool whose bare name is ExitPlanMode as a plan proposal", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tu-mcp-exit",
          name: "mcp__srv__ExitPlanMode",
          input: { plan: "not Copilot's plan flow" },
        },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-mcp-exit",
      vendorToolName: "ExitPlanMode",
      mcpServer: "srv",
    });
    expect(out[0].update).not.toMatchObject({ isPlanProposal: true });
    expect(out[0].update).not.toMatchObject({ kind: "switch_mode" });
  });

  it("does not flip into plan mode for an MCP tool whose bare name is EnterPlanMode", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tu-mcp-enter",
          name: "mcp__srv__EnterPlanMode",
          input: {},
        },
      }),
      SESSION_ID,
      state
    );
    // Only the tool_call — no current_mode_update.
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({ sessionUpdate: "tool_call", mcpServer: "srv" });
  });

  it("threads parent_tool_use_id into parentToolCallId on streamed tool_use", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "child-1", name: "Read", input: {} },
        },
        parent_tool_use_id: "task-parent-1",
        uuid: "uuid-p" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "child-1",
      vendorToolName: "Read",
      parentToolCallId: "task-parent-1",
    });
  });

  it("threads parent_tool_use_id through tool_call_update on input_json_delta", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "child-2", name: "Read", input: {} },
        },
        parent_tool_use_id: "task-parent-2",
        uuid: "uuid-p2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path":"a.md"}' },
        },
        parent_tool_use_id: "task-parent-2",
        uuid: "uuid-p3" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "child-2",
      vendorToolName: "Read",
      parentToolCallId: "task-parent-2",
    });
  });

  it("omits parentToolCallId when parent_tool_use_id is null", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-top", name: "Read", input: {} },
      }),
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      vendorToolName: "Read",
    });
    expect(out[0].update).not.toHaveProperty("parentToolCallId");
  });

  it("threads parent_tool_use_id on assistant-message fallback path", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "assistant",

        message: {
          content: [{ type: "tool_use", id: "child-3", name: "Read", input: { path: "a.md" } }],
        } as never,
        parent_tool_use_id: "task-parent-3",
        uuid: "uuid-p4" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      },
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "child-3",
      vendorToolName: "Read",
      parentToolCallId: "task-parent-3",
    });
  });

  it("ignores partial input_json that doesn't parse yet", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-6", name: "Read", input: {} },
      }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":"a.md' },
      }),
      SESSION_ID,
      state
    );
    expect(out).toEqual([]);
  });

  it("preserves notification-only lifecycle ordering at the session-event boundary", () => {
    const frames = readFixture();
    const state = createTranslatorState();
    const events: SessionEvent[] = [];
    const completedLaunches = new Set<string>();

    expect(JSON.stringify(frames)).not.toContain("TaskOutput");
    for (const frame of frames) {
      const translated = translateSdkMessage(frame.payload, "replay-session", state);
      events.push(...translated);
      for (const { update } of translated) {
        if (update.sessionUpdate !== "tool_call_update") continue;
        if (!update.toolCallId.startsWith("launch-")) continue;
        if (update.status === "completed") completedLaunches.add(update.toolCallId);
        if (completedLaunches.has(update.toolCallId)) expect(update.status).not.toBe("in_progress");
      }
    }

    const updates = events.map(({ update }) => update);
    const launches = updates.filter(
      (update): update is Extract<SessionUpdate, { sessionUpdate: "tool_call" }> =>
        update.sessionUpdate === "tool_call" && update.vendorToolName === "Agent"
    );
    expect(launches.map(({ toolCallId }) => toolCallId)).toEqual(["launch-a", "launch-b"]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "launch-a",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Structure report from the automatic notification." },
          },
        ],
      })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "launch-b",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Themes report from the automatic notification." },
          },
        ],
      })
    );
    expect(updates).toContainEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Combined final response from both reports." },
    });
  });

  describe("background subagent system frames", () => {
    const UUID = "uuid-1" as `${string}-${string}-${string}-${string}-${string}`;

    function systemMessage(fields: Record<string, unknown>): SDKMessage {
      return {
        type: "system",
        uuid: UUID,
        session_id: SESSION_ID,
        ...fields,
      } as unknown as SDKMessage;
    }

    function launchAckResult(toolUseId: string, agentId = "abc123"): SDKMessage {
      return {
        type: "user",
        tool_use_result: { isAsync: true, status: "async_launched", agentId },
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              is_error: false,
              content: [{ type: "text", text: "Async agent launched successfully." }],
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      } as unknown as SDKMessage;
    }

    function trackToolUse(
      state: ReturnType<typeof createTranslatorState>,
      id: string,
      name: string,
      input: Record<string, unknown> = {}
    ): void {
      translateSdkMessage(
        streamEvent({
          type: "content_block_start",
          index: state.emittedToolUseIds.size,
          content_block: { type: "tool_use", id, name, input },
        }),
        SESSION_ID,
        state
      );
    }

    function trackStreamedToolUse(
      state: ReturnType<typeof createTranslatorState>,
      index: number,
      id: string,
      name: string,
      input: Record<string, unknown>
    ): void {
      translateSdkMessage(
        streamEvent({
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id, name, input: {} },
        }),
        SESSION_ID,
        state
      );
      translateSdkMessage(
        streamEvent({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
        }),
        SESSION_ID,
        state
      );
      translateSdkMessage(streamEvent({ type: "content_block_stop", index }), SESSION_ID, state);
    }

    // Task frames only apply once we've tracked the launch (agentId "abc123" →
    // card "tu-launch"); seed that so the gate lets them through.
    function seedLaunch(state: ReturnType<typeof createTranslatorState>): void {
      trackToolUse(state, "tu-launch", "Agent");
      translateSdkMessage(launchAckResult("tu-launch"), SESSION_ID, state);
    }

    it("binds task_started before the async acknowledgement arrives", () => {
      const state = createTranslatorState();
      trackToolUse(state, "tu-launch", "Agent");

      const started = translateSdkMessage(
        systemMessage({
          subtype: "task_started",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          description: "Analyze vault",
        }),
        SESSION_ID,
        state
      );

      expect(started[0].update).toMatchObject({
        toolCallId: "tu-launch",
        status: "in_progress",
      });
      expect(translateSdkMessage(launchAckResult("tu-launch"), SESSION_ID, state)).toEqual([]);
    });

    it("folds task_notification onto the launch card as its output + terminal status", () => {
      const state = createTranslatorState();
      seedLaunch(state);
      const out = translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          status: "completed",
          summary: "Most prominent category: AI/agents (16 notes).",
        }),
        SESSION_ID,
        state
      );
      expect(out).toEqual([
        {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tu-launch",
            status: "completed",
            content: [
              {
                type: "content",
                content: { type: "text", text: "Most prominent category: AI/agents (16 notes)." },
              },
            ],
          },
        },
      ]);
    });

    it("maps a non-completed task_notification status to failed", () => {
      const state = createTranslatorState();
      seedLaunch(state);
      const out = translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          status: "stopped",
          summary: "",
        }),
        SESSION_ID,
        state
      );
      expect(out).toHaveLength(1);
      expect(out[0].update).toMatchObject({ toolCallId: "tu-launch", status: "failed" });
      // Empty summary contributes no content field (nothing to render).
      expect((out[0].update as { content?: unknown }).content).toBeUndefined();
    });

    it.each([
      ["completed", "completed"],
      ["stopped", "failed"],
    ])("uses the shared terminal mapping for task_notification status %s", (status, expected) => {
      const state = createTranslatorState();
      seedLaunch(state);
      const out = translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          status,
        }),
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({ toolCallId: "tu-launch", status: expected });
    });

    it("keeps task_started in progress and normalizes meaningful task_progress", () => {
      const state = createTranslatorState();
      seedLaunch(state);
      expect(
        translateSdkMessage(
          systemMessage({
            subtype: "task_started",
            task_id: "abc123",
            tool_use_id: "tu-launch",
            description: "started",
          }),
          SESSION_ID,
          state
        )[0].update
      ).toEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: "tu-launch",
        status: "in_progress",
      });
      expect(
        translateSdkMessage(
          systemMessage({
            subtype: "task_progress",
            task_id: "abc123",
            tool_use_id: "tu-launch",
            description: "Count markdown files",
            last_tool_name: "Read",
            usage: { tool_uses: 3, duration_ms: 9851, total_tokens: 4210 },
          }),
          SESSION_ID,
          state
        )[0].update
      ).toEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: "tu-launch",
        status: "in_progress",
        progress: {
          description: "Count markdown files",
          toolName: "Read",
          toolUses: 3,
          durationMs: 9851,
          totalTokens: 4210,
        },
      });
    });

    it("ignores a straggling task_progress after the notification settled the card", () => {
      const state = createTranslatorState();
      seedLaunch(state);
      translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          status: "completed",
          summary: "done",
        }),
        SESSION_ID,
        state
      );
      const out = translateSdkMessage(
        systemMessage({
          subtype: "task_progress",
          task_id: "abc123",
          tool_use_id: "tu-launch",
          description: "…",
        }),
        SESSION_ID,
        state
      );
      expect(out).toEqual([]);
    });

    it("ignores a task_notification that is not a tracked subagent launch (background Bash/Monitor)", () => {
      const state = createTranslatorState();
      seedLaunch(state); // tracks agentId "abc123" → "tu-launch"
      // A background Bash finishing: task_id/tool_use_id don't match the tracked
      // launch, so it must NOT clobber that (or any) card.
      expect(
        translateSdkMessage(
          systemMessage({
            subtype: "task_notification",
            task_id: "bash-task",
            tool_use_id: "tu-bash",
            status: "completed",
            summary: "done",
          }),
          SESSION_ID,
          state
        )
      ).toEqual([]);
      // Right task_id but a different tool_use_id (stale/other card) is also ignored.
      expect(
        translateSdkMessage(
          systemMessage({
            subtype: "task_notification",
            task_id: "abc123",
            tool_use_id: "tu-other",
            status: "completed",
            summary: "done",
          }),
          SESSION_ID,
          state
        )
      ).toEqual([]);
    });

    it("correlates task frames with no tool_use_id after acknowledgement", () => {
      const state = createTranslatorState();
      seedLaunch(state);

      const progress = translateSdkMessage(
        systemMessage({
          subtype: "task_progress",
          task_id: "abc123",
          description: "Count notes",
        }),
        SESSION_ID,
        state
      );
      const completed = translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          status: "completed",
          summary: "done",
        }),
        SESSION_ID,
        state
      );

      expect(progress[0].update).toMatchObject({
        toolCallId: "tu-launch",
        status: "in_progress",
        progress: { description: "Count notes" },
      });
      expect(completed[0].update).toMatchObject({
        toolCallId: "tu-launch",
        status: "completed",
      });
    });

    it("keeps task identity across translator generations until terminal output arrives", () => {
      const firstQuery = createTranslatorState();
      seedLaunch(firstQuery);
      translateSdkMessage(resultMsg({}), SESSION_ID, firstQuery);
      const nextQuery = createTranslatorState(firstQuery.claudeTasks, firstQuery.backgroundTasks);

      const completed = translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          status: "completed",
          summary: "finished after the first query",
        }),
        SESSION_ID,
        nextQuery
      );
      const lateProgress = translateSdkMessage(
        systemMessage({
          subtype: "task_progress",
          task_id: "abc123",
          description: "too late",
        }),
        SESSION_ID,
        nextQuery
      );

      expect(completed[0].update).toMatchObject({
        toolCallId: "tu-launch",
        status: "completed",
      });
      expect(lateProgress).toEqual([]);
    });

    it("settles the launch when task_updated carries a terminal patch status", () => {
      const state = createTranslatorState();
      seedLaunch(state);

      const settled = translateSdkMessage(
        systemMessage({
          subtype: "task_updated",
          task_id: "abc123",
          patch: { status: "completed" },
        }),
        SESSION_ID,
        state
      );

      expect(settled[0].update).toMatchObject({
        sessionUpdate: "tool_call_update",
        toolCallId: "tu-launch",
        status: "completed",
      });
    });

    it("ignores task_updated frames whose patch is not terminal", () => {
      const state = createTranslatorState();
      seedLaunch(state);

      expect(
        translateSdkMessage(
          systemMessage({
            subtype: "task_updated",
            task_id: "abc123",
            patch: { status: "running" },
          }),
          SESSION_ID,
          state
        )
      ).toEqual([]);
    });

    it("suppresses the async-launch ack tool_result so the launch stays in_progress", () => {
      const state = createTranslatorState();
      trackToolUse(state, "tu-launch", "Agent");
      expect(translateSdkMessage(launchAckResult("tu-launch"), SESSION_ID, state)).toEqual([]);
    });

    it("suppresses only the launch-ack block, still translating a batched sibling result", () => {
      const state = createTranslatorState();
      trackToolUse(state, "tu-launch", "Agent");
      trackToolUse(state, "tu-read", "Read");
      const batched = {
        type: "user",
        tool_use_result: { isAsync: true, status: "async_launched", agentId: "abc123" },
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-launch",
              content: [{ type: "text", text: "Async agent launched successfully." }],
            },
            { type: "tool_result", tool_use_id: "tu-read", content: "file contents" },
          ],
        },
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      } as unknown as SDKMessage;
      const out = translateSdkMessage(batched, SESSION_ID, state);
      // Only the sibling Read is translated; the launch ack is suppressed.
      expect(out).toHaveLength(1);
      expect(out[0].update).toMatchObject({ toolCallId: "tu-read", status: "completed" });
    });

    it("matches a batched launch ack to the Agent result when it is not the first block", () => {
      const state = createTranslatorState();
      trackToolUse(state, "tu-read", "Read");
      trackToolUse(state, "tu-launch", "Agent");
      const batched = {
        type: "user",
        tool_use_result: { isAsync: true, status: "async_launched", agentId: "abc123" },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu-read", content: "file contents" },
            {
              type: "tool_result",
              tool_use_id: "tu-launch",
              content: [{ type: "text", text: "Async agent launched successfully." }],
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      } as unknown as SDKMessage;

      const out = translateSdkMessage(batched, SESSION_ID, state);

      expect(out).toHaveLength(1);
      expect(out[0].update).toMatchObject({ toolCallId: "tu-read", status: "completed" });
    });

    it("uses explicit task identity when launch inputs stream from empty snapshots", () => {
      const state = createTranslatorState();
      trackStreamedToolUse(state, 0, "tu-foreground", "Agent", {
        prompt: "foreground prompt",
      });
      trackStreamedToolUse(state, 1, "tu-background", "Task", {
        prompt: "background prompt",
      });
      translateSdkMessage(
        systemMessage({
          subtype: "task_started",
          task_id: "abc123",
          tool_use_id: "tu-background",
          description: "Background task",
        }),
        SESSION_ID,
        state
      );
      const acknowledged = translateSdkMessage(
        {
          type: "user",
          tool_use_result: {
            isAsync: true,
            status: "async_launched",
            agentId: "abc123",
            prompt: "metadata is not an identity key",
          },
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tu-foreground", content: "done" },
              {
                type: "tool_result",
                tool_use_id: "tu-background",
                content: "opaque internal acknowledgement",
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as unknown as SDKMessage,
        SESSION_ID,
        state
      );

      const progress = translateSdkMessage(
        systemMessage({
          subtype: "task_progress",
          task_id: "abc123",
          description: "Count notes",
        }),
        SESSION_ID,
        state
      );

      expect(acknowledged).toEqual([
        {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tu-foreground",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
          },
        },
      ]);
      expect(progress[0].update).toMatchObject({
        toolCallId: "tu-background",
        status: "in_progress",
        progress: { description: "Count notes" },
      });
    });

    it("keeps the first terminal status when an ordinary result supplies late output", () => {
      const state = createTranslatorState();
      trackToolUse(state, "tu-launch", "Agent");
      translateSdkMessage(launchAckResult("tu-launch"), SESSION_ID, state);
      translateSdkMessage(
        systemMessage({
          subtype: "task_notification",
          task_id: "abc123",
          status: "completed",
        }),
        SESSION_ID,
        state
      );

      const lateOutput = translateSdkMessage(
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu-launch",
                content: "late output",
                is_error: true,
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as unknown as SDKMessage,
        SESSION_ID,
        state
      );

      expect(lateOutput).toEqual([
        {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tu-launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "late output" } }],
          },
        },
      ]);
    });

    it("still completes a genuine (non-launch) tool_result", () => {
      const state = createTranslatorState();
      const out = translateSdkMessage(
        {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tu-real", content: "done", is_error: false },
            ],
          },
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as unknown as SDKMessage,
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({ toolCallId: "tu-real", status: "completed" });
    });
  });
});

describe("session todo-list normalization (TodoWrite / Task tools → plan)", () => {
  function userMessage(content: unknown[], parent: string | null = null): SDKMessage {
    return {
      type: "user",
      message: { content },
      parent_tool_use_id: parent,
      uuid: "uuid-u" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: SESSION_ID,
    } as never;
  }

  it("emits a plan event alongside the tool events for a TodoWrite stream", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "todo-1", name: "TodoWrite", input: {} },
      }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json:
            '{"todos":[{"content":"step A","status":"in_progress","activeForm":"Doing A"}]}',
        },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(2);
    expect(out[1].update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "step A", status: "in_progress", priority: "medium" }],
    });
    // The block-stop re-observation of the same final input must not re-emit.
    const stop = translateSdkMessage(
      streamEvent({ type: "content_block_stop", index: 0 }),
      SESSION_ID,
      state
    );
    expect(stop.filter((e) => e.update.sessionUpdate === "plan")).toHaveLength(0);
  });

  it("accumulates Task tools across messages: create → result id → update", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "task-create-1",
          name: "TaskCreate",
          input: { subject: "Brainstorm imagery" },
        },
      }),
      SESSION_ID,
      state
    );
    const bound = translateSdkMessage(
      userMessage([
        {
          type: "tool_result",
          tool_use_id: "task-create-1",
          // The real claude CLI string shape — id is the `#N` ordinal.
          content: "Task #1 created successfully: Brainstorm imagery",
          is_error: false,
        },
      ]),
      SESSION_ID,
      state
    );
    const boundPlan = bound.find((e) => e.update.sessionUpdate === "plan");
    expect(boundPlan?.update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "Brainstorm imagery", status: "pending", priority: "medium" }],
    });

    const updated = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "task-upd-1",
          name: "TaskUpdate",
          input: { taskId: "1", status: "in_progress" },
        },
      }),
      SESSION_ID,
      state
    );
    const updatedPlan = updated.find((e) => e.update.sessionUpdate === "plan");
    expect(updatedPlan?.update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "Brainstorm imagery", status: "in_progress", priority: "medium" }],
    });
  });

  it("ignores subagent calls (parent_tool_use_id set) and MCP tools sharing the name", () => {
    const state = createTranslatorState();
    const subagent = translateSdkMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "sub-1",
            name: "TodoWrite",
            input: { todos: [{ content: "sub task", status: "pending" }] },
          },
        },
        parent_tool_use_id: "parent-1",
        uuid: "uuid-s" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      } as never,
      SESSION_ID,
      state
    );
    expect(subagent.filter((e) => e.update.sessionUpdate === "plan")).toHaveLength(0);

    const mcp = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "mcp-1",
          name: "mcp__tracker__TodoWrite",
          input: { todos: [{ content: "mcp task", status: "pending" }] },
        },
      }),
      SESSION_ID,
      state
    );
    expect(mcp.filter((e) => e.update.sessionUpdate === "plan")).toHaveLength(0);
  });

  it("shares the accumulator across translator generations via createTranslatorState(shared)", () => {
    const turn1 = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "c1",
          name: "TaskCreate",
          input: { subject: "persist me" },
        },
      }),
      SESSION_ID,
      turn1
    );
    translateSdkMessage(
      userMessage([
        {
          type: "tool_result",
          tool_use_id: "c1",
          content: "Task #7 created successfully: persist me",
          is_error: false,
        },
      ]),
      SESSION_ID,
      turn1
    );

    // Turn 2: fresh translator, same session-lived accumulator.
    const turn2 = createTranslatorState(turn1.claudeTasks);
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "u1",
          name: "TaskUpdate",
          input: { taskId: "7", status: "completed" },
        },
      }),
      SESSION_ID,
      turn2
    );
    const plan = out.find((e) => e.update.sessionUpdate === "plan");
    expect(plan?.update).toEqual({
      sessionUpdate: "plan",
      entries: [{ content: "persist me", status: "completed", priority: "medium" }],
    });
  });
});

function resultMessage(overrides: {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  modelUsage?: Record<string, { contextWindow: number }>;
  total_cost_usd?: number;
}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    usage: overrides.usage,
    modelUsage: overrides.modelUsage ?? {},
    total_cost_usd: overrides.total_cost_usd ?? 0,
    session_id: SESSION_ID,
  } as unknown as SDKMessage;
}

describe("translateSdkMessage — result → usage_update", () => {
  const FIXED_NOW = 1_700_000_000_000;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });
  afterEach(() => nowSpy.mockRestore());

  it("matches the bare assistant model id to the suffixed modelUsage key", () => {
    const state = createTranslatorState();
    // Real runtime shape: the assistant message reports the bare id
    // "claude-opus-4-8" while the result keys it "claude-opus-4-8[1m]". An exact
    // lookup misses — a prefix match must recover the main model's 1M window and
    // NOT fall to the smaller-windowed aux model. Final call occupancy:
    // 100 + 5000 + 300 + 20 = 5420.
    translateSdkMessage(
      assistantMsg(
        {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 300,
        },
        { model: "claude-opus-4-8" }
      ),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      resultMessage({
        // Cumulative result usage — deliberately huge; now ignored for occupancy.
        usage: {
          input_tokens: 9999,
          output_tokens: 9999,
          cache_read_input_tokens: 9999,
          cache_creation_input_tokens: 9999,
        },
        modelUsage: {
          "claude-opus-4-8[1m]": { contextWindow: 1_000_000 },
          "claude-haiku-4-5-20251001": { contextWindow: 200_000 },
        },
      }),
      SESSION_ID,
      state
    );
    expect(out).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: "usage_update",
          usage: {
            usedTokens: 5420,
            contextWindow: 1_000_000,
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 5000,
            cacheWriteTokens: 300,
            updatedAt: FIXED_NOW,
          },
        },
      },
    ]);
  });

  it("emits usedTokens with undefined contextWindow when modelUsage lacks the model", () => {
    const state = createTranslatorState();
    translateSdkMessage(assistantMsg({ input_tokens: 10, output_tokens: 2 }), SESSION_ID, state);
    const out = translateSdkMessage(
      resultMessage({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        // No matching model entry → no window: count-only, never a wrong ring.
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    const update = out[0].update as { sessionUpdate: string; usage: Record<string, unknown> };
    expect(update.sessionUpdate).toBe("usage_update");
    expect(update.usage.usedTokens).toBe(12);
    expect(update.usage.contextWindow).toBeUndefined();
  });
});

describe("mapStopReason()", () => {
  it("maps success → end_turn", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mapStopReason({ type: "result", subtype: "success" } as any)).toBe("end_turn");
  });
  it("maps error variants → cancelled", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mapStopReason({ type: "result", subtype: "error_during_execution" } as any)).toBe(
      "cancelled"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mapStopReason({ type: "result", subtype: "error_max_turns" } as any)).toBe("cancelled");
  });
});
