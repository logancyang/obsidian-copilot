import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeBackgroundTaskStateMachine } from "./claudeTaskProtocol";

// These fixtures mirror carriers captured from Claude Code 2.1.206. Keeping
// the carrier shapes visible makes each test read as one protocol transcript.
interface ToolResultFixture {
  id: string;
  content?: unknown;
  isError?: boolean;
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
        ...(result.isError ? { is_error: true } : {}),
      })),
    },
    parent_tool_use_id: null,
    session_id: "test-session",
  } as unknown as SDKMessage;
}

function launchAck(agentId: string, ...toolCallIds: string[]): SDKMessage {
  return userMessage(
    toolCallIds.map((id) => ({ id, content: "Async agent launched successfully." })),
    { isAsync: true, status: "async_launched", agentId }
  );
}

function systemMessage(frame: Record<string, unknown>): SDKMessage {
  return { type: "system", ...frame } as unknown as SDKMessage;
}

function observeTool(
  protocol: ClaudeBackgroundTaskStateMachine,
  toolCallId: string,
  nativeToolName: string
): void {
  protocol.accept({ kind: "tool_snapshot", toolCallId, nativeToolName });
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
        });
        const second = protocol.accept({
          kind: "tool_snapshot",
          toolCallId: "mcp-task",
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

      it("keeps identified foreground task identity terminal after its ordinary result", () => {
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

        const result = acceptMessage(
          protocol,
          userMessage([{ id: "launch", content: "foreground report" }])
        );
        const lateProgress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "too late",
          })
        );
        observeTool(protocol, "replacement", "Agent");
        const duplicateIdentity = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "replacement",
          })
        );

        expect(result).toEqual({ updates: [], resultActions: new Map() });
        expect(lateProgress.updates).toEqual([]);
        expect(duplicateIdentity.updates).toEqual([]);
      });

      it("binds late foreground task identity without reopening a terminal launch", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(
          protocol,
          userMessage([{ id: "launch", content: "foreground report", isError: true }])
        );

        const lateStart = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "launch",
          })
        );
        const lateProgress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "too late",
          })
        );
        observeTool(protocol, "replacement", "Task");
        const duplicateIdentity = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "replacement",
          })
        );

        expect(lateStart.updates).toEqual([]);
        expect(lateProgress.updates).toEqual([]);
        expect(duplicateIdentity.updates).toEqual([]);
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
            subtype: "task_checkpoint",
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

      it("settles a bound launch from a terminal task_updated patch", () => {
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

        const updated = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_updated",
            task_id: "task-a",
            patch: { status: "completed" },
          })
        );

        expect(updated.updates).toEqual([{ toolCallId: "launch", status: "completed" }]);
      });

      it("fails a bound launch from a killed task_updated patch and surfaces its error", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(protocol, launchAck("task-a", "launch"));

        const killed = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_updated",
            task_id: "task-a",
            patch: { status: "killed", error: "killed by user" },
          })
        );

        expect(killed.updates).toEqual([
          {
            toolCallId: "launch",
            status: "failed",
            content: [{ type: "content", content: { type: "text", text: "killed by user" } }],
          },
        ]);
      });

      it("ignores non-terminal task_updated patches", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(protocol, launchAck("task-a", "launch"));

        const running = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_updated",
            task_id: "task-a",
            patch: { status: "running", description: "still going" },
          })
        );

        expect(running.updates).toEqual([]);
      });

      it("replays a task-only terminal frame once the launch acknowledgement binds", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");

        const early = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
            summary: "done",
          })
        );
        const acknowledged = acceptMessage(protocol, launchAck("task-a", "launch"));

        expect(early.updates).toEqual([]);
        expect(acknowledged.updates).toEqual([
          {
            toolCallId: "launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
          },
        ]);
        expect(acknowledged.resultActions.get("launch")).toEqual({ kind: "omit" });
      });

      it("does not infer task identity from prompt or description", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "other", "Agent");
        observeTool(protocol, "background", "Task");

        const acknowledged = acceptMessage(
          protocol,
          userMessage(
            [
              { id: "other", content: "foreground report" },
              { id: "background", content: "opaque internal acknowledgement" },
            ],
            {
              isAsync: true,
              status: "async_launched",
              agentId: "task-a",
              prompt: "background prompt",
              description: "Background task",
            }
          )
        );
        const taskOnlyProgress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "working",
          })
        );
        const started = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "background",
          })
        );

        expect(acknowledged.resultActions).toEqual(new Map());
        expect(taskOnlyProgress.updates).toEqual([]);
        expect(started.updates).toEqual([{ toolCallId: "background", status: "in_progress" }]);
      });

      it("uses an explicit task binding to select an acknowledgement from multiple launches", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch-a", "Agent");
        observeTool(protocol, "launch-b", "Task");

        const started = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "launch-b",
          })
        );

        const acknowledged = acceptMessage(
          protocol,
          userMessage(
            [
              { id: "launch-a", content: "first result" },
              { id: "launch-b", content: "second result" },
            ],
            {
              isAsync: true,
              status: "async_launched",
              agentId: "task-a",
            }
          )
        );

        expect(started.updates).toEqual([{ toolCallId: "launch-b", status: "in_progress" }]);
        expect(acknowledged.resultActions).toEqual(new Map([["launch-b", { kind: "omit" }]]));
      });

      it("preserves an earlier pending terminal report when a later patch has no output", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");

        acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
            summary: "done",
          })
        );
        acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_updated",
            task_id: "task-a",
            patch: { status: "completed" },
          })
        );

        const acknowledged = acceptMessage(protocol, launchAck("task-a", "launch"));

        expect(acknowledged.updates).toEqual([
          {
            toolCallId: "launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
          },
        ]);
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

      it("uses a prior task binding to suppress a batched asynchronous acknowledgement", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "foreground", "Agent");
        observeTool(protocol, "background", "Task");
        acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "background",
          })
        );

        const acknowledged = acceptMessage(
          protocol,
          userMessage(
            [
              { id: "foreground", content: "foreground report" },
              { id: "background", content: "opaque internal acknowledgement" },
            ],
            { isAsync: true, status: "async_launched", agentId: "task-a" }
          )
        );
        const progress = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "Count notes",
          })
        );

        expect(acknowledged.resultActions).toEqual(new Map([["background", { kind: "omit" }]]));
        expect(progress.updates).toEqual([
          {
            toolCallId: "background",
            status: "in_progress",
            progress: { description: "Count notes" },
          },
        ]);
        expect(
          acceptMessage(
            protocol,
            systemMessage({
              subtype: "task_started",
              task_id: "task-a",
              tool_use_id: "foreground",
            })
          ).updates
        ).toEqual([]);
      });

      it("retains terminal identity until a delayed output frame completes the card", () => {
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
        const terminalStatus = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
          })
        );

        const terminalOutput = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
            summary: "late",
          })
        );
        const afterCompletion = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_progress",
            task_id: "task-a",
            description: "too late",
          })
        );
        observeTool(protocol, "replacement", "Task");
        const duplicateIdentity = acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_started",
            task_id: "task-a",
            tool_use_id: "replacement",
          })
        );

        expect(terminalStatus.updates).toEqual([{ toolCallId: "launch", status: "completed" }]);
        expect(terminalOutput.updates).toEqual([
          {
            toolCallId: "launch",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "late" } }],
          },
        ]);
        expect(afterCompletion.updates).toEqual([]);
        expect(duplicateIdentity.updates).toEqual([]);
      });

      it("preserves the first terminal status when an ordinary result supplies late output", () => {
        const protocol = new ClaudeBackgroundTaskStateMachine();
        observeTool(protocol, "launch", "Agent");
        acceptMessage(protocol, launchAck("task-a", "launch"));
        acceptMessage(
          protocol,
          systemMessage({
            subtype: "task_notification",
            task_id: "task-a",
            status: "completed",
          })
        );

        const lateOutput = acceptMessage(
          protocol,
          userMessage([{ id: "launch", content: "late output", isError: true }])
        );

        expect(lateOutput.resultActions.get("launch")).toEqual({
          kind: "preserve_status",
          status: "completed",
        });
      });
    });
  });
});
