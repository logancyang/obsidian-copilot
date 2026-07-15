import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeBackgroundTaskStateMachine } from "./claudeTaskProtocol";

// These fixtures mirror carriers captured from Claude Code 2.1.206. Keeping
// the carrier shapes visible makes each test read as one protocol transcript.
interface ToolResultFixture {
  id: string;
  content?: unknown;
}

function userMessage(
  toolResults: ToolResultFixture[],
  toolUseResult?: Record<string, unknown>
): SDKMessage {
  return {
    type: "user",
    ...(toolUseResult ? { tool_use_result: toolUseResult } : {}),
    message: {
      content: toolResults.map((result) => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.content ?? "done",
      })),
    },
    parent_tool_use_id: null,
    session_id: "test-session",
  } as unknown as SDKMessage;
}

function launchAck(agentId: string, ...toolCallIds: string[]): SDKMessage {
  return userMessage(
    toolCallIds.map((id) => ({ id })),
    { isAsync: true, status: "async_launched", agentId }
  );
}

function systemMessage(frame: Record<string, unknown>): SDKMessage {
  return { type: "system", ...frame } as unknown as SDKMessage;
}

function observeTool(
  protocol: ClaudeBackgroundTaskStateMachine,
  toolCallId: string,
  nativeToolName: string,
  input: unknown = {}
): void {
  protocol.accept({ kind: "tool_snapshot", toolCallId, nativeToolName, input });
}

function acceptMessage(protocol: ClaudeBackgroundTaskStateMachine, message: SDKMessage) {
  return protocol.accept({ kind: "sdk_message", message });
}

describe("claudeTaskProtocol", () => {
  describe("ClaudeBackgroundTaskStateMachine", () => {
    describe("accept()", () => {
      it("returns one stable empty decision for unrelated carriers", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();

        const first = protocol.accept({
          kind: "tool_snapshot",
          toolCallId: "read-a",
          nativeToolName: "Read",
          input: {},
        });
        const second = protocol.accept({
          kind: "tool_snapshot",
          toolCallId: "mcp-task",
          input: {},
        });

        expect(first).toEqual({ updates: [], resultActions: new Map() });
        expect(second).toBe(first);
      });

      it("binds a launch from task_started before its asynchronous acknowledgement", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");

        const started = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "launch",
          })
        );
        const acknowledged = acceptMessage(protocol, launchAck("task-a", "launch"));

        expect(started.updates).toEqual([{ toolCallId: "launch", status: "in_progress" }]);
        expect(acknowledged.resultActions.get("launch")).toEqual({ kind: "omit" });
      });

      it("correlates task-only progress and terminal frames after the launch acknowledgement", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(protocol, launchAck("task-a", "launch"));

        const progress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "Count notes",
          })
        );
        const completed = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
            summary: "done",
          })
        );

        expect(progress.updates).toEqual([
          {
            toolCallId: "launch",
            status: "in_progress",
            progress: { description: "Count notes" },
          },
        ]);
        expect(completed.updates).toEqual([
          {
            toolCallId: "launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
          },
        ]);
      });

      it("ignores task-only frames without an unambiguous launch binding", () => {
        const unknown = new ClaudeBackgroundTaskStateMachine();
        expect(
          acceptMessage(
            unknown,
            systemMessage({
              subtype: "task_progress",
              task_id: "unknown-task",
              description: "working",
            })
          ).updates
        ).toEqual([]);

        const ambiguous = new ClaudeBackgroundTaskStateMachine();
        observeTool(ambiguous, "launch-a", "Agent");
        observeTool(ambiguous, "launch-b", "Task");
        acceptMessage(ambiguous, launchAck("task-a", "launch-a", "launch-b"));

        expect(
          acceptMessage(
            ambiguous,
            systemMessage({
              subtype: "task_notification",
              task_id: "task-a",
              status: "completed",
              summary: "done",
            })
          ).updates
        ).toEqual([]);
      });

      it("does not let an unsupported system subtype establish task identity", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");

        const unsupported = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_updated",
            task_id: "task-a",
            tool_use_id: "launch",
          })
        );
        const laterStart = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-b",
            tool_use_id: "launch",
          })
        );

        expect(unsupported.updates).toEqual([]);
        expect(laterStart.updates).toEqual([{ toolCallId: "launch", status: "in_progress" }]);
      });

      it("normalizes progress and never regresses a terminal launch", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");

        const progress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            tool_use_id: "launch",
            description: "Count notes",
            last_tool_name: "Glob",
            usage: {
              tool_uses: 3,
              duration_ms: 9851,
              total_tokens: Number.POSITIVE_INFINITY,
            },
          })
        );
        const completed = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            tool_use_id: "launch",
            status: "completed",
            summary: "done",
          })
        );
        const lateProgress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            tool_use_id: "launch",
          })
        );
        const conflictingFailure = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            tool_use_id: "launch",
            status: "failed",
            summary: "late failure",
          })
        );

        expect(progress.updates).toEqual([
          {
            toolCallId: "launch",
            status: "in_progress",
            progress: {
              description: "Count notes",
              toolName: "Glob",
              toolUses: 3,
              durationMs: 9851,
            },
          },
        ]);
        expect(completed.updates).toEqual([
          {
            toolCallId: "launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
          },
        ]);
        expect(lateProgress.updates).toEqual([]);
        expect(conflictingFailure.updates).toEqual([]);
      });

      it("omits only a uniquely attributable asynchronous launch acknowledgement", () => {
        const unique = new ClaudeBackgroundTaskStateMachine();
        observeTool(unique, "launch", "Agent");
        const uniqueDecision = acceptMessage(unique, launchAck("task-a", "launch"));

        const ambiguous = new ClaudeBackgroundTaskStateMachine();
        observeTool(ambiguous, "launch-a", "Agent");
        observeTool(ambiguous, "launch-b", "Task");
        const ambiguousDecision = acceptMessage(
          ambiguous,
          launchAck("task-a", "launch-a", "launch-b")
        );

        expect(uniqueDecision.resultActions.get("launch")).toEqual({ kind: "omit" });
        expect(ambiguousDecision.resultActions.size).toBe(0);

        const lateFrame = acceptMessage(
          ambiguous,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "launch-a",
          })
        );
        expect(lateFrame.updates).toEqual([]);
      });

      it("clears query-owned identity when the query finishes", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "launch",
          })
        );
        protocol.accept({ kind: "query_finished" });

        const lateTerminal = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            tool_use_id: "launch",
            status: "completed",
            summary: "late",
          })
        );
        expect(lateTerminal.updates).toEqual([]);
      });
    });
  });
});
