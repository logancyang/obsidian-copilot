import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createTranslatorState, mapStopReason, translateSdkMessage } from "./sdkMessageTranslator";

const SESSION_ID = "session-test-1";

function streamEvent(event: object): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: SESSION_ID,
  } as SDKMessage;
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
      emittedToolCall: false,
    });
    translateSdkMessage(streamEvent({ type: "message_start", message: {} }), SESSION_ID, state);
    expect(state.toolUseBlocks.size).toBe(0);
  });

  it("returns [] for `result` (caller resolves the prompt promise separately)", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "result",
        subtype: "success",
        duration_ms: 0,
        duration_api_ms: 0,
        is_error: false,
        num_turns: 1,
        result: "ok",
        stop_reason: "end_turn",
        total_cost_usd: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        usage: {} as any,
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-2" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      } as SDKMessage,
      SESSION_ID,
      state
    );
    expect(out).toEqual([]);
  });

  it("ignores assistant messages whose tool_use blocks were already streamed", () => {
    const state = createTranslatorState();
    // Pretend the streaming path already saw this tool_use.
    state.toolUseBlocks.set(0, {
      id: "tool-1",
      name: "vault_read",
      inputJsonAcc: '{"path":"a.md"}',
      lastParsedInput: { path: "a.md" },
      emittedToolCall: true,
    });
    expect(
      translateSdkMessage(
        {
          type: "assistant",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          message: {
            content: [
              { type: "tool_use", id: "tool-1", name: "vault_read", input: { path: "a.md" } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: "uuid-a" as `${string}-${string}-${string}-${string}-${string}`,
          session_id: SESSION_ID,
        } as SDKMessage,
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
        content_block: { type: "tool_use", id: "tu-1", name: "vault_read", input: {} },
      }),
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "tu-1",
      kind: "read",
      _meta: { claude: { toolName: "vault_read" } },
    });
  });

  it("emits tool_call_update with parsed rawInput on input_json_delta", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-2", name: "vault_read", input: {} },
      }),
      SESSION_ID,
      state
    );
    const out = translateSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":"a.md"}' },
      }),
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tu-2",
      rawInput: { path: "a.md" },
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-4",
              content: "vault contents",
              is_error: false,
            },
          ],
        } as any,
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      } as SDKMessage,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu-5", content: "boom", is_error: true }],
        } as any,
        parent_tool_use_id: null,
        session_id: SESSION_ID,
      } as SDKMessage,
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
      _meta: { claude: { toolName: "do_thing" } },
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
          name: "mcp__obsidian-vault__vault_read",
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
      kind: "read",
      title: "vault_read Daily/2026-05-01.md",
      _meta: { claude: { toolName: "vault_read" } },
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
      _meta: { claude: { toolName: "ExitPlanMode" } },
    });
  });

  it("threads parent_tool_use_id into _meta.claude.parentToolUseId on streamed tool_use", () => {
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
      } as SDKMessage,
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "child-1",
      _meta: { claude: { toolName: "Read", parentToolUseId: "task-parent-1" } },
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
      } as SDKMessage,
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
      } as SDKMessage,
      SESSION_ID,
      state
    );
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "child-2",
      _meta: { claude: { toolName: "Read", parentToolUseId: "task-parent-2" } },
    });
  });

  it("omits parentToolUseId when parent_tool_use_id is null", () => {
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
      _meta: { claude: { toolName: "Read" } },
    });
    const meta = (out[0].update as { _meta?: { claude?: Record<string, unknown> } })._meta;
    expect(meta?.claude).not.toHaveProperty("parentToolUseId");
  });

  it("threads parent_tool_use_id on assistant-message fallback path", () => {
    const state = createTranslatorState();
    const out = translateSdkMessage(
      {
        type: "assistant",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: {
          content: [{ type: "tool_use", id: "child-3", name: "Read", input: { path: "a.md" } }],
        } as any,
        parent_tool_use_id: "task-parent-3",
        uuid: "uuid-p4" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: SESSION_ID,
      } as SDKMessage,
      SESSION_ID,
      state
    );
    expect(out).toHaveLength(1);
    expect(out[0].update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "child-3",
      _meta: { claude: { toolName: "Read", parentToolUseId: "task-parent-3" } },
    });
  });

  it("ignores partial input_json that doesn't parse yet", () => {
    const state = createTranslatorState();
    translateSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu-6", name: "vault_read", input: {} },
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
});

describe("mapStopReason", () => {
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
