import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeTaskTracker, isAsyncLaunchResult } from "./claudeTaskProtocol";

const ISSUE_175 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/175";

function frame(fields: Record<string, unknown>): SDKMessage {
  return { type: "system", uuid: "u", session_id: "s", ...fields } as unknown as SDKMessage;
}

function started(taskId: string, fields: Record<string, unknown> = {}): SDKMessage {
  return frame({
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: `tool-${taskId}`,
    description: `Task ${taskId}`,
    task_type: "local_agent",
    is_backgrounded: true,
    ...fields,
  });
}

function notification(taskId: string, fields: Record<string, unknown> = {}): SDKMessage {
  return frame({
    subtype: "task_notification",
    task_id: taskId,
    tool_use_id: `tool-${taskId}`,
    status: "completed",
    summary: `Report from ${taskId}`,
    output_file: `/tmp/tasks/${taskId}.output`,
    ...fields,
  });
}

describe("claudeTaskProtocol", () => {
  describe("ClaudeTaskTracker", () => {
    describe("accept()", () => {
      it(`reports a subagent's start with what it was asked to do, and its end with its report and output file (${ISSUE_175})`, () => {
        const tracker = new ClaudeTaskTracker();

        const start = tracker.accept(
          started("a1", { prompt: "Count the words", subagent_type: "general-purpose" })
        );
        const end = tracker.accept(notification("a1"));

        expect(start).toEqual([
          {
            sessionUpdate: "task_started",
            taskId: "a1",
            toolCallId: "tool-a1",
            kind: "subagent",
            description: "Task a1",
            prompt: "Count the words",
            subagentType: "general-purpose",
          },
        ]);
        expect(end).toEqual([
          {
            sessionUpdate: "task_ended",
            taskId: "a1",
            status: "completed",
            summary: "Report from a1",
            outputFile: "/tmp/tasks/a1.output",
          },
        ]);
      });

      it("reports a subagent's progress in the card's progress shape", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));

        const progress = tracker.accept(
          frame({
            subtype: "task_progress",
            task_id: "a1",
            description: "Running wc -w",
            last_tool_name: "Bash",
            usage: { tool_uses: 3, duration_ms: 9851, total_tokens: 4210 },
          })
        );

        expect(progress).toEqual([
          {
            sessionUpdate: "task_progress",
            taskId: "a1",
            progress: {
              description: "Running wc -w",
              toolName: "Bash",
              toolUses: 3,
              durationMs: 9851,
              totalTokens: 4210,
            },
          },
        ]);
      });

      it(`reports a background command as a command task, and a foreground command only once it moves to the background (${ISSUE_175})`, () => {
        const tracker = new ClaudeTaskTracker();

        const background = tracker.accept(started("b1", { task_type: "local_bash" }));
        const foreground = tracker.accept(
          started("b2", { task_type: "local_bash", is_backgrounded: false })
        );
        const moved = tracker.accept(
          frame({ subtype: "task_updated", task_id: "b2", patch: { is_backgrounded: true } })
        );

        expect(background).toMatchObject([{ sessionUpdate: "task_started", kind: "command" }]);
        expect(foreground).toEqual([]);
        expect(moved).toMatchObject([{ sessionUpdate: "task_started", taskId: "b2" }]);
      });

      it("never reports a foreground command that ends in the foreground", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("b1", { task_type: "local_bash", is_backgrounded: false }));

        expect(tracker.accept(notification("b1"))).toEqual([]);
      });

      it(`reports an end that arrives before its start right after the start (${ISSUE_175})`, () => {
        const tracker = new ClaudeTaskTracker();

        const early = tracker.accept(notification("a1"));
        const start = tracker.accept(started("a1"));

        expect(early).toEqual([]);
        expect(start.map((update) => update.sessionUpdate)).toEqual(["task_started", "task_ended"]);
      });

      it(`reports each end once, ignoring a repeated notification and progress after the end (${ISSUE_175})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));
        tracker.accept(notification("a1"));

        expect(tracker.accept(notification("a1", { status: "stopped" }))).toEqual([]);
        expect(
          tracker.accept(
            frame({ subtype: "task_progress", task_id: "a1", usage: { tool_uses: 9 } })
          )
        ).toEqual([]);
      });

      it("hides ambient housekeeping tasks", () => {
        const tracker = new ClaudeTaskTracker();

        expect(tracker.accept(started("w1", { ambient: true }))).toEqual([]);
        expect(tracker.accept(notification("w1"))).toEqual([]);
      });
    });

    describe("isRunningInBackground()", () => {
      it("is true for a running background launch only", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));
        tracker.accept(started("a2", { is_backgrounded: false }));

        expect(tracker.isRunningInBackground("tool-a1")).toBe(true);
        expect(tracker.isRunningInBackground("tool-a2")).toBe(false);
        tracker.accept(notification("a1"));
        expect(tracker.isRunningInBackground("tool-a1")).toBe(false);
      });
    });

    describe("stopRunning()", () => {
      it(`ends every running task as stopped once, so the orphan end Claude reports after resuming is dropped (${ISSUE_175})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));
        tracker.accept(started("a2"));
        tracker.accept(notification("a2"));

        const stopped = tracker.stopRunning();

        expect(stopped).toEqual([{ sessionUpdate: "task_ended", taskId: "a1", status: "stopped" }]);
        expect(tracker.stopRunning()).toEqual([]);
        expect(
          tracker.accept(
            notification("a1", {
              status: "stopped",
              summary: "No completion record was found for this background task.",
            })
          )
        ).toEqual([]);
      });
    });
  });

  describe("isAsyncLaunchResult()", () => {
    it.each([
      ["a background subagent", { isAsync: true, status: "async_launched", agentId: "a1" }],
      ["a workflow", { status: "async_launched", taskId: "w1" }],
      ["a background command", { stdout: "", backgroundTaskId: "b1" }],
    ])("recognizes the launch result of %s", (_name, result) => {
      expect(isAsyncLaunchResult(result)).toBe(true);
    });

    it("does not treat a finished tool's result as a launch", () => {
      expect(isAsyncLaunchResult({ stdout: "done", stderr: "" })).toBe(false);
      expect(isAsyncLaunchResult(undefined)).toBe(false);
    });
  });
});
