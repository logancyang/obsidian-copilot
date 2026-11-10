import fs from "fs";
import path from "path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionUpdate, SessionUsage } from "@/agentMode/session/types";
import {
  createTranslatorState,
  mapStopReason,
  replayClaudeTranscript,
  translateSdkMessage,
  type TranslatorState,
} from "./sdkMessageTranslator";
import { createClaudeTaskPlanState } from "./claudeTodoPlan";

const SESSION_ID = "session-test-1";

interface FixtureFrame {
  tag: string;
  payload: SDKMessage;
}

function readFixture(name = "claude-notification-only-subagents"): FixtureFrame[] {
  const fixturePath = path.join(__dirname, `__fixtures__/${name}.ndjson`);
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

function manualCompactionState(): TranslatorState {
  return Object.assign(createTranslatorState(), { compactionTrigger: "manual" as const });
}

function userMessage(content: unknown[], parent: string | null = null): SDKMessage {
  return {
    type: "user",
    message: { content },
    parent_tool_use_id: parent,
    uuid: "uuid-u" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: SESSION_ID,
  } as never;
}

describe("sdkMessageTranslator", () => {
  describe("translateSdkMessage()", () => {
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

    it("ignores input_json and signature deltas when no tool block is open", () => {
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

    it("emits nothing for message_start, message_stop, and text content_block_start/stop", () => {
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
        translateSdkMessage(
          streamEvent({ type: "content_block_stop", index: 0 }),
          SESSION_ID,
          state
        )
      ).toEqual([]);
    });

    it("drops input_json deltas for a tool block opened before a new message_start", () => {
      const state = createTranslatorState();
      translateSdkMessage(
        streamEvent({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "stale-tool", name: "Read", input: {} },
        }),
        SESSION_ID,
        state
      );
      translateSdkMessage(streamEvent({ type: "message_start", message: {} }), SESSION_ID, state);

      const out = translateSdkMessage(
        streamEvent({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"file_path":"a.md"}' },
        }),
        SESSION_ID,
        state
      );

      expect(out).toEqual([]);
    });

    it("ignores assistant messages whose tool_use blocks were already streamed", () => {
      const state = createTranslatorState();
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
            content: [
              { type: "tool_result", tool_use_id: "tu-5", content: "boom", is_error: true },
            ],
          } as never,
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        },
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({ status: "failed" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/747 shows a tool call Claude stopped before it ran as stopped, while a call the user rejected stays failed", () => {
      const cancelText =
        "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
      const out = translateSdkMessage(
        {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tu-cut", content: cancelText, is_error: true },
              { type: "tool_result", tool_use_id: "tu-denied", content: "No.", is_error: true },
            ],
          } as never,
          tool_result_meta: [
            { id: "tu-cut", non_execution_kind: "cancelled" },
            { id: "tu-denied", non_execution_kind: "user-rejected" },
          ],
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as never,
        SESSION_ID,
        createTranslatorState()
      );

      expect(out.map((e) => e.update)).toEqual([
        expect.objectContaining({ toolCallId: "tu-cut", status: "cancelled" }),
        expect.objectContaining({ toolCallId: "tu-denied", status: "failed" }),
      ]);
    });

    it("forwards the pre-edit file content an Edit result carries, keyed by the edited file", () => {
      const state = createTranslatorState();
      const out = translateSdkMessage(
        {
          type: "user",
          tool_use_result: {
            filePath: "/vault/notes/a.md",
            originalFile: "before the edit\n",
            userModified: false,
          },
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu-edit", content: "ok" }],
          } as never,
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as never,
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({
        sessionUpdate: "tool_call_update",
        toolCallId: "tu-edit",
        status: "completed",
        originalFiles: { "/vault/notes/a.md": "before the edit\n" },
      });
    });

    it("forwards a null original so a file the Write created reports no prior content (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      const state = createTranslatorState();
      const out = translateSdkMessage(
        {
          type: "user",
          tool_use_result: {
            type: "create",
            filePath: "/vault/notes/new.md",
            content: "fresh\n",
            originalFile: null,
          },
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu-write", content: "ok" }],
          } as never,
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as never,
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({
        toolCallId: "tu-write",
        originalFiles: { "/vault/notes/new.md": null },
      });
    });

    it("omits the original when a Write updates an existing file the SDK reports no original for (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      const state = createTranslatorState();
      const out = translateSdkMessage(
        {
          type: "user",
          tool_use_result: {
            type: "update",
            filePath: "/vault/notes/large.md",
            content: "rewritten\n",
            originalFile: null,
          },
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu-write", content: "ok" }],
          } as never,
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as never,
        SESSION_ID,
        state
      );
      expect(out[0].update).toMatchObject({ toolCallId: "tu-write", status: "completed" });
      expect(out[0].update).not.toHaveProperty("originalFiles");
    });

    it("omits originals for a tool result that carries no pre-edit content", () => {
      const state = createTranslatorState();
      const out = translateSdkMessage(
        {
          type: "user",
          tool_use_result: { stdout: "listing" },
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu-bash", content: "ok" }],
          } as never,
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        } as never,
        SESSION_ID,
        state
      );
      expect(out[0].update).not.toHaveProperty("originalFiles");
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/749 reports a streamed Agent call as a task at its first frame, right after its tool call", () => {
      const state = createTranslatorState();

      const out = translateSdkMessage(
        streamEvent({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu-agent", name: "Agent", input: {} },
        }),
        SESSION_ID,
        state
      ).map(({ update }) => update.sessionUpdate);

      expect(out).toEqual(["tool_call", "task_started"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 reports each subagent of a recording with out-of-order task frames as one launch, one start and one end, and hides their launch acknowledgements", () => {
      const state = createTranslatorState();
      const updates = readFixture().flatMap((frame) =>
        translateSdkMessage(frame.payload, "replay-session", state).map(({ update }) => update)
      );

      const lifecycle = updates.flatMap((update) =>
        update.sessionUpdate === "task_started"
          ? [`task_started ${update.taskId ?? `launch ${update.toolCallId}`}`]
          : update.sessionUpdate === "task_ended"
            ? [`task_ended ${update.taskId}`]
            : []
      );
      expect(lifecycle).toEqual([
        "task_started launch launch-a",
        "task_started task-a",
        "task_started launch launch-b",
        "task_started task-b",
        "task_ended task-b",
        "task_ended task-a",
      ]);
      expect(updates).toContainEqual({
        sessionUpdate: "task_ended",
        taskId: "task-b",
        status: "completed",
        summary: "Themes report from the automatic notification.",
      });
      expect(updates.some((update) => update.sessionUpdate === "tool_call_update")).toBe(false);
      expect(updates).toContainEqual({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Combined final response from both reports." },
      });
    });

    describe("background task launches", () => {
      it.each([
        ["first", ["tu-launch", "tu-read"]],
        ["last", ["tu-read", "tu-launch"]],
      ])(
        "drops the launch acknowledgement but still translates its batched sibling result when the ack is %s",
        (_position, order) => {
          const state = createTranslatorState();
          for (const id of order) trackToolUse(state, id, id === "tu-launch" ? "Agent" : "Read");
          translateSdkMessage(
            systemMessage({
              subtype: "task_started",
              task_id: "abc123",
              tool_use_id: "tu-launch",
              task_type: "local_agent",
              is_backgrounded: true,
            }),
            SESSION_ID,
            state
          );
          const resultBlocks = {
            "tu-launch": {
              type: "tool_result",
              tool_use_id: "tu-launch",
              content: [{ type: "text", text: "Async agent launched successfully." }],
            },
            "tu-read": { type: "tool_result", tool_use_id: "tu-read", content: "file contents" },
          };
          const batched = {
            type: "user",
            tool_use_result: { isAsync: true, status: "async_launched", agentId: "abc123" },
            message: { content: order.map((id) => resultBlocks[id as keyof typeof resultBlocks]) },
            parent_tool_use_id: null,
            session_id: SESSION_ID,
          } as unknown as SDKMessage;

          const out = translateSdkMessage(batched, SESSION_ID, state);

          expect(out).toHaveLength(1);
          expect(out[0].update).toMatchObject({ toolCallId: "tu-read", status: "completed" });
        }
      );

      it("drops a launch acknowledgement that arrives before its task_started frame", () => {
        const state = createTranslatorState();
        trackToolUse(state, "tu-launch", "Agent");

        expect(translateSdkMessage(launchAckResult("tu-launch"), SESSION_ID, state)).toEqual([]);
      });

      it("settles a foreground subagent's card from its ordinary result", () => {
        const state = createTranslatorState();
        trackToolUse(state, "tu-agent", "Agent");
        translateSdkMessage(
          systemMessage({
            subtype: "task_started",
            task_id: "abc123",
            tool_use_id: "tu-agent",
            task_type: "local_agent",
            is_backgrounded: false,
          }),
          SESSION_ID,
          state
        );

        const out = translateSdkMessage(
          userMessage([{ type: "tool_result", tool_use_id: "tu-agent", content: "report" }]),
          SESSION_ID,
          state
        );

        expect(out[0].update).toMatchObject({ toolCallId: "tu-agent", status: "completed" });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 emits a subagent's whole-message text and thinking, which never stream", () => {
        const state = createTranslatorState();

        const out = translateSdkMessage(
          {
            type: "assistant",
            message: {
              content: [
                { type: "thinking", thinking: "Count first." },
                { type: "text", text: "6 words." },
              ],
            },
            parent_tool_use_id: "tu-agent",
            uuid: UUID,
            session_id: SESSION_ID,
          } as unknown as SDKMessage,
          SESSION_ID,
          state
        );

        expect(out.map((e) => e.update)).toEqual([
          { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Count first." } },
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "6 words." } },
        ]);
      });
    });

    describe("task details for the task views", () => {
      const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";

      function assistantFrame(
        content: unknown[],
        parentToolUseId: string | null,
        model?: string
      ): SDKMessage {
        return {
          type: "assistant",
          message: { content, ...(model ? { model } : {}) },
          parent_tool_use_id: parentToolUseId,
          uuid: UUID,
          session_id: SESSION_ID,
        } as unknown as SDKMessage;
      }

      it(`reports a background command's command at its start and its output file from its launch result, and still hides the launch result (${ISSUE_749})`, () => {
        const state = createTranslatorState();
        translateSdkMessage(
          assistantFrame(
            [{ type: "tool_use", id: "tu-bash", name: "Bash", input: { command: "make render" } }],
            null
          ),
          SESSION_ID,
          state
        );

        const start = translateSdkMessage(
          systemMessage({
            subtype: "task_started",
            task_id: "b1",
            tool_use_id: "tu-bash",
            description: "Render",
            task_type: "local_bash",
            is_backgrounded: true,
          }),
          SESSION_ID,
          state
        );
        const ack = translateSdkMessage(
          {
            type: "user",
            tool_use_result: { stdout: "", stderr: "", backgroundTaskId: "b1" },
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tu-bash",
                  content:
                    "Command running in background with ID: b1. Output is being written to: /tmp/s1/tasks/b1.output. You will be notified when it completes.",
                },
              ],
            },
            parent_tool_use_id: null,
            session_id: SESSION_ID,
          } as unknown as SDKMessage,
          SESSION_ID,
          state
        );

        expect(start.map((e) => e.update)).toEqual([
          expect.objectContaining({ sessionUpdate: "task_started", command: "make render" }),
        ]);
        expect(ack.map((e) => e.update)).toEqual([
          { sessionUpdate: "task_progress", taskId: "b1", outputFile: "/tmp/s1/tasks/b1.output" },
        ]);
      });

      it(`reports a subagent's model from its own assistant frames (${ISSUE_749})`, () => {
        const state = createTranslatorState();
        translateSdkMessage(
          systemMessage({
            subtype: "task_started",
            task_id: "a1",
            tool_use_id: "tu-agent",
            task_type: "local_agent",
          }),
          SESSION_ID,
          state
        );

        const out = translateSdkMessage(
          assistantFrame([{ type: "text", text: "Counting." }], "tu-agent", "claude-haiku-9"),
          SESSION_ID,
          state
        );

        expect(out.map((e) => e.update)).toContainEqual({
          sessionUpdate: "task_progress",
          taskId: "a1",
          model: "claude-haiku-9",
        });
      });

      it(`shows a subagent's hand-back as its last message, not as a tool call with a result (${ISSUE_749})`, () => {
        const state = createTranslatorState();

        const handback = translateSdkMessage(
          assistantFrame(
            [
              {
                type: "tool_use",
                id: "tu-handback",
                name: "SubagentHandback",
                input: { message: "Welcome.md has 9 words." },
              },
            ],
            "tu-agent"
          ),
          SESSION_ID,
          state
        );
        const result = translateSdkMessage(
          userMessage(
            [{ type: "tool_result", tool_use_id: "tu-handback", content: "Report delivered." }],
            "tu-agent"
          ),
          SESSION_ID,
          state
        );

        expect(handback.map((e) => e.update)).toEqual([
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Welcome.md has 9 words." },
          },
        ]);
        expect(result).toEqual([]);
      });
    });

    describe("TodoWrite and Task tools emit plan events", () => {
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
    });

    describe("compaction system frames", () => {
      const ISSUE_635 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/635";

      function translateFixture(
        name: string,
        state = createTranslatorState()
      ): { updates: SessionUpdate[]; state: TranslatorState } {
        const updates = readFixture(name).flatMap((frame) =>
          translateSdkMessage(frame.payload, SESSION_ID, state).map((e) => e.update)
        );
        return { updates, state };
      }

      function isCompaction(update: SessionUpdate): boolean {
        return update.sessionUpdate === "compaction";
      }

      function statusFrame(extra: object, uuid: string): SDKMessage {
        return {
          type: "system",
          subtype: "status",
          status: null,
          uuid,
          session_id: SESSION_ID,
          ...extra,
        } as unknown as SDKMessage;
      }

      function translateOne(msg: SDKMessage, state: TranslatorState): SessionUpdate[] {
        return translateSdkMessage(msg, SESSION_ID, state).map((e) => e.update);
      }

      it("turns a recorded manual /compact into a running compaction that completes with the token counts", () => {
        const { updates } = translateFixture("claude-compact-manual", manualCompactionState());

        expect(updates).toEqual([
          {
            sessionUpdate: "compaction",
            id: "20000000-0000-0000-0000-000000000001",
            status: "in_progress",
            trigger: "manual",
          },
          {
            sessionUpdate: "compaction",
            id: "20000000-0000-0000-0000-000000000001",
            status: "completed",
            trigger: "manual",
            preTokens: 103249,
            postTokens: 4046,
          },
        ]);
      });

      it("opens a recorded automatic compaction as automatic and reports the boundary's trigger on completion", () => {
        const { updates } = translateFixture("claude-compact-auto");

        expect(updates).toEqual([
          expect.objectContaining({
            id: expect.any(String),
            status: "in_progress",
            trigger: "auto",
          }),
          expect.objectContaining({
            status: "completed",
            trigger: "auto",
            preTokens: 70500,
            postTokens: 3813,
          }),
        ]);
      });

      it(`keeps repeated compacting statuses on the one open compaction (${ISSUE_635})`, () => {
        const state = createTranslatorState();
        const ids = ["repeat-1", "repeat-2", "repeat-3"].flatMap((uuid) =>
          translateOne(statusFrame({ status: "compacting" }, uuid), state).map(
            (u) => (u as { id: string }).id
          )
        );

        expect(ids).toEqual(["repeat-1", "repeat-1", "repeat-1"]);
      });

      it(`gives a compaction that starts after the previous one finished its own id (${ISSUE_635})`, () => {
        const state = createTranslatorState();
        translateOne(statusFrame({ status: "compacting" }, "first"), state);
        translateOne(statusFrame({ compact_result: "failed", compact_error: "boom" }, "f"), state);

        const next = translateOne(statusFrame({ status: "compacting" }, "second"), state);

        expect(next).toEqual([expect.objectContaining({ id: "second", status: "in_progress" })]);
      });

      it(`creates a completed row when a boundary arrives with no compacting status before it (${ISSUE_635})`, () => {
        const [boundary] = readFixture("claude-compact-manual").filter(
          (f) => (f.payload as { subtype?: string }).subtype === "compact_boundary"
        );

        const updates = translateOne(boundary.payload, createTranslatorState());

        expect(updates).toEqual([
          {
            sessionUpdate: "compaction",
            id: "20000000-0000-0000-0000-000000000003",
            status: "completed",
            trigger: "manual",
            preTokens: 103249,
            postTokens: 4046,
          },
        ]);
      });

      it(`leaves the completed compaction without token counts when the boundary reports no post_tokens (${ISSUE_635})`, () => {
        const state = createTranslatorState();
        const updates = translateOne(
          {
            type: "system",
            subtype: "compact_boundary",
            uuid: "boundary",
            session_id: SESSION_ID,
            compact_metadata: { trigger: "manual", pre_tokens: 900 },
          } as unknown as SDKMessage,
          state
        );

        expect(updates).toEqual([
          {
            sessionUpdate: "compaction",
            id: "boundary",
            status: "completed",
            trigger: "manual",
            preTokens: 900,
            postTokens: undefined,
          },
        ]);
      });

      it("shows a failed compaction with Claude's error", () => {
        const { updates } = translateFixture("claude-compact-stopped");

        expect(updates.filter(isCompaction)).toEqual([
          expect.objectContaining({ status: "in_progress" }),
          expect.objectContaining({ status: "failed", error: "API Error: Request was aborted." }),
        ]);
      });

      it(`reports nothing to compact as skipped, not failed, and adds no agent text for it (${ISSUE_635})`, () => {
        const { updates } = translateFixture(
          "claude-compact-nothing-to-compact",
          manualCompactionState()
        );

        expect(updates.filter(isCompaction)).toEqual([
          expect.objectContaining({ status: "in_progress", trigger: "manual" }),
          {
            sessionUpdate: "compaction",
            id: expect.any(String),
            status: "skipped",
            trigger: "manual",
          },
        ]);
        expect(updates.map((u) => u.sessionUpdate)).not.toContain("agent_message_chunk");
      });

      it(`drops the context usage sampled before a compaction so the turn result cannot restore the full meter (${ISSUE_635})`, () => {
        const state = createTranslatorState();
        translateOne(assistantMsg({ input_tokens: 90000, output_tokens: 10 }), state);

        const { updates } = translateFixture("claude-compact-auto", state);

        expect(updates.map((u) => u.sessionUpdate)).not.toContain("usage_update");
      });
    });

    describe("usage_update on a turn result", () => {
      const FIXED_NOW = 1_700_000_000_000;
      let nowSpy: jest.SpyInstance;

      beforeEach(() => {
        nowSpy = jest.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
      });
      afterEach(() => nowSpy.mockRestore());

      it("reports occupancy from the last assistant message, not the cumulative result total", () => {
        const state = createTranslatorState();
        translateSdkMessage(
          assistantMsg({
            input_tokens: 100,
            cache_creation_input_tokens: 10_000,
            output_tokens: 50,
          }),
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

      it("matches the bare assistant model id to the suffixed modelUsage key", () => {
        const state = createTranslatorState();
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
          resultMsg({
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
        translateSdkMessage(
          assistantMsg({ input_tokens: 10, output_tokens: 2 }),
          SESSION_ID,
          state
        );
        const out = translateSdkMessage(
          resultMsg({
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
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
  });

  describe("replayClaudeTranscript()", () => {
    const ISSUE_643 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/643";

    function transcript(...entries: object[]): string {
      return entries.map((entry) => JSON.stringify(entry)).join("\n");
    }

    function userEntry(uuid: string, content: unknown, extra: object = {}): object {
      return { type: "user", uuid, message: { role: "user", content }, ...extra };
    }

    function assistantEntry(content: unknown[], extra: object = {}): object {
      return { type: "assistant", message: { role: "assistant", content }, ...extra };
    }

    function replay(jsonl: string, claudeTasks = createClaudeTaskPlanState()): SessionUpdate[] {
      return replayClaudeTranscript(jsonl, SESSION_ID, claudeTasks).map((e) => e.update);
    }

    it("replays a turn's prompt, thinking, reply, and tool call with its result as live-shaped updates in transcript order", () => {
      const jsonl = transcript(
        userEntry("u-1", "<user-message>\nlist the notes\n</user-message>"),
        assistantEntry([{ type: "thinking", thinking: "I should list them.", signature: "sig" }]),
        assistantEntry([{ type: "text", text: "Listing now." }]),
        assistantEntry([
          { type: "tool_use", id: "tool-ls", name: "Bash", input: { command: "ls notes" } },
        ]),
        userEntry("u-2", [
          { type: "tool_result", tool_use_id: "tool-ls", content: "a.md\nb.md", is_error: false },
        ]),
        assistantEntry([{ type: "text", text: "You have two notes." }])
      );

      const events = replayClaudeTranscript(jsonl, SESSION_ID, createClaudeTaskPlanState());

      expect(events.every((e) => e.sessionId === SESSION_ID)).toBe(true);
      expect(events.map((e) => e.update)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "<user-message>\nlist the notes\n</user-message>" },
          messageId: "u-1",
        },
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "I should list them." },
        },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Listing now." } },
        {
          sessionUpdate: "tool_call",
          toolCallId: "tool-ls",
          title: "Bash: ls notes",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "ls notes" },
          mcpServer: undefined,
          vendorToolName: "Bash",
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-ls",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "a.md\nb.md" } }],
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "You have two notes." },
        },
      ]);
    });

    it(`stamps every update with the time of the transcript entry it came from, and leaves it unstamped when that time is missing or unreadable (${ISSUE_643})`, () => {
      const jsonl = transcript(
        userEntry("u-1", "read it", { timestamp: "2026-10-03T19:31:18.348Z" }),
        assistantEntry(
          [
            { type: "text", text: "Reading." },
            { type: "tool_use", id: "tool-read", name: "Read", input: { file_path: "a.md" } },
          ],
          { timestamp: "2026-10-03T19:31:22.374Z" }
        ),
        userEntry("u-2", [{ type: "tool_result", tool_use_id: "tool-read", content: "hi" }]),
        assistantEntry([{ type: "text", text: "Done." }], { timestamp: "not a date" })
      );

      const events = replayClaudeTranscript(jsonl, SESSION_ID, createClaudeTaskPlanState());

      expect(events.map((e) => [e.update.sessionUpdate, e.occurredAt])).toEqual([
        ["user_message_chunk", Date.parse("2026-10-03T19:31:18.348Z")],
        ["agent_message_chunk", Date.parse("2026-10-03T19:31:22.374Z")],
        ["tool_call", Date.parse("2026-10-03T19:31:22.374Z")],
        ["tool_call_update", undefined],
        ["agent_message_chunk", undefined],
      ]);
    });

    it("gives each user prompt its own message id and joins the text blocks of a multimodal prompt without its images", () => {
      const jsonl = transcript(
        userEntry("u-1", [
          { type: "text", text: "what is in" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "text", text: "this picture?" },
        ]),
        userEntry("u-2", "and this one?")
      );

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "what is in\n\nthis picture?" },
          messageId: "u-1",
        },
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "and this one?" },
          messageId: "u-2",
        },
      ]);
    });

    it("marks a tool call whose result is an error as failed and keeps the error text as its output", () => {
      const jsonl = transcript(
        assistantEntry([
          { type: "tool_use", id: "tool-read", name: "Read", input: { file_path: "/x.md" } },
        ]),
        userEntry("u-1", [
          {
            type: "tool_result",
            tool_use_id: "tool-read",
            content: [{ type: "text", text: "File does not exist." }],
            is_error: true,
          },
        ])
      );

      expect(replay(jsonl)[1]).toEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-read",
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: "File does not exist." } }],
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/747 replays a tool call Claude stopped before it ran as stopped, and leaves it stopped when the replay ends", () => {
      const jsonl = transcript(
        assistantEntry([
          { type: "tool_use", id: "tool-cut", name: "Bash", input: { command: "ls" } },
        ]),
        userEntry(
          "u-1",
          [{ type: "tool_result", tool_use_id: "tool-cut", content: "Stopped.", is_error: true }],
          { toolDenialKind: "cancelled" }
        )
      );

      const updates = replay(jsonl).filter((u) => u.sessionUpdate === "tool_call_update");

      expect(updates).toEqual([
        expect.objectContaining({ toolCallId: "tool-cut", status: "cancelled" }),
      ]);
    });

    it(`marks a tool call the transcript never answered as failed once the replay ends, so it does not show as running forever (${ISSUE_643})`, () => {
      const jsonl = transcript(
        userEntry("u-1", "run it"),
        assistantEntry([
          { type: "tool_use", id: "tool-done", name: "Bash", input: { command: "ls" } },
        ]),
        userEntry("u-2", [{ type: "tool_result", tool_use_id: "tool-done", content: "a.md" }]),
        assistantEntry([
          { type: "tool_use", id: "tool-cut", name: "Bash", input: { command: "sleep 99" } },
        ])
      );

      const updates = replay(jsonl);

      expect(updates.at(-1)).toEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-cut",
        status: "failed",
      });
      expect(
        updates.filter((u) => u.sessionUpdate === "tool_call_update" && u.status === "failed")
      ).toHaveLength(1);
    });

    it("replays a TodoWrite call as the todo plan it set", () => {
      const jsonl = transcript(
        assistantEntry([
          {
            type: "tool_use",
            id: "todo-1",
            name: "TodoWrite",
            input: { todos: [{ content: "Draft outline", status: "in_progress" }] },
          },
        ])
      );

      expect(replay(jsonl)).toContainEqual({
        sessionUpdate: "plan",
        entries: [{ content: "Draft outline", status: "in_progress", priority: "medium" }],
      });
    });

    it("seeds the session's task plan so a live TaskUpdate after reopening updates a task created in a replayed turn", () => {
      const claudeTasks = createClaudeTaskPlanState();
      replayClaudeTranscript(
        transcript(
          assistantEntry([
            {
              type: "tool_use",
              id: "create-1",
              name: "TaskCreate",
              input: { subject: "Collect sources" },
            },
          ]),
          userEntry("u-1", [
            {
              type: "tool_result",
              tool_use_id: "create-1",
              content: "Task #1 created successfully: Collect sources",
            },
          ])
        ),
        SESSION_ID,
        claudeTasks
      );

      const live = translateSdkMessage(
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
        SESSION_ID,
        createTranslatorState(claudeTasks)
      );

      expect(live.map((e) => e.update)).toContainEqual({
        sessionUpdate: "plan",
        entries: [{ content: "Collect sources", status: "completed", priority: "medium" }],
      });
    });

    it(`skips meta, sidechain, compaction-summary, and non-conversation entries so they never become bubbles (${ISSUE_643})`, () => {
      const jsonl = transcript(
        { type: "queue-operation" },
        { type: "attachment", uuid: "att-1" },
        userEntry("meta-1", "<local-command-caveat>ignore</local-command-caveat>", {
          isMeta: true,
        }),
        assistantEntry([{ type: "text", text: "subagent step" }], { isSidechain: true }),
        userEntry("summary-1", "This session is being continued from a previous conversation.", {
          isCompactSummary: true,
        }),
        userEntry("u-1", "real prompt")
      );

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "real prompt" },
          messageId: "u-1",
        },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/635 skips the command echo and hook output Claude records for a local command such as /compact", () => {
      const jsonl = transcript(
        userEntry(
          "echo-1",
          "<command-name>/compact</command-name>\n<command-message>compact</command-message>"
        ),
        userEntry("out-1", "<local-command-stdout>Compacted</local-command-stdout>"),
        userEntry("u-1", "real prompt")
      );

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "real prompt" },
          messageId: "u-1",
        },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 skips the stand-ins Claude records around a stopped turn, and ends the turn at each input Claude adds on its own but not at a human-origin prompt, so the agent's own reply stands apart", () => {
      const jsonl = transcript(
        userEntry("u-1", "real prompt"),
        userEntry("stop-1", [{ type: "text", text: "[Request interrupted by user]" }]),
        userEntry("stop-2", [{ type: "text", text: "[Request interrupted by user for tool use]" }]),
        assistantEntry([{ type: "text", text: "No response requested." }]),
        assistantEntry([{ type: "text", text: "Started it." }]),
        userEntry("handback-1", "Another Claude session sent a message", {
          isMeta: true,
          origin: { kind: "peer", handback: true },
        }),
        assistantEntry([{ type: "text", text: "The subagent finished." }]),
        userEntry("note-1", "<task-notification>\n<task-id>a1</task-id>\n</task-notification>", {
          origin: { kind: "task-notification" },
        }),
        userEntry("u-2", "typed by the user", { origin: { kind: "human" } })
      );

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "real prompt" },
          messageId: "u-1",
        },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Started it." } },
        { sessionUpdate: "turn_ended", turnId: "", stopReason: "end_turn" },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "The subagent finished." },
        },
        { sessionUpdate: "turn_ended", turnId: "", stopReason: "end_turn" },
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "typed by the user" },
          messageId: "u-2",
        },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 replays a message the user sent while the agent worked at the point it reached the agent, and skips queued task notifications and messages from other agents", () => {
      const queued = (attachment: object): object => ({
        type: "attachment",
        attachment: { type: "queued_command", ...attachment },
      });
      const jsonl = transcript(
        userEntry("u-1", "run six steps"),
        assistantEntry([{ type: "text", text: "Step 1 done." }]),
        queued({ commandMode: "prompt", prompt: "stop after step 2", source_uuid: "steer-1" }),
        queued({
          commandMode: "prompt",
          prompt: [{ type: "text", text: "and say ALPHA" }],
          source_uuid: "steer-2",
          origin: { kind: "human" },
        }),
        queued({ commandMode: "task-notification", prompt: "<task-notification>…" }),
        queued({ commandMode: "prompt", prompt: "subagent report", origin: { kind: "peer" } }),
        assistantEntry([{ type: "text", text: "Stopped. ALPHA" }])
      );

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "run six steps" },
          messageId: "u-1",
        },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Step 1 done." } },
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "stop after step 2" },
          messageId: "steer-1",
        },
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "and say ALPHA" },
          messageId: "steer-2",
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Stopped. ALPHA" },
        },
      ]);
    });

    it(`finishes a replayed background task's tool call from its launch result instead of leaving it running (${ISSUE_643})`, () => {
      const jsonl = transcript(
        assistantEntry([
          {
            type: "tool_use",
            id: "bg-1",
            name: "Bash",
            input: { command: "npm test", run_in_background: true },
          },
        ]),
        userEntry("u-1", [
          {
            type: "tool_result",
            tool_use_id: "bg-1",
            content: "Command running in background with ID: shell-1",
          },
        ])
      );

      expect(replay(jsonl).map((u) => [u.sessionUpdate, "status" in u ? u.status : null])).toEqual([
        ["tool_call", "in_progress"],
        ["tool_call_update", "completed"],
      ]);
    });

    it(`skips a line that is not complete JSON, such as one still being written (${ISSUE_643})`, () => {
      const jsonl = `${transcript(userEntry("u-1", "first prompt"))}\n{"type":"assistant","mess`;

      expect(replay(jsonl)).toEqual([
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "first prompt" },
          messageId: "u-1",
        },
      ]);
    });
  });

  describe("createTranslatorState()", () => {
    it("carries the task plan accumulator into the next state so a later TaskUpdate resolves an earlier TaskCreate", () => {
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
      expect(mapStopReason({ type: "result", subtype: "error_max_turns" } as any)).toBe(
        "cancelled"
      );
    });
  });
});
