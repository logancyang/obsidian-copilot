import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeTaskTracker } from "./claudeTaskProtocol";

const ISSUE_175 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/175";
const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";
const LAUNCH_TEXT =
  "Command running in background with ID: b1. Output is being written to: /tmp/claude/s1/tasks/b1.output. You will be notified when it completes.";

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

    describe("observeToolUse()", () => {
      it(`reports a subagent as a task from its tool call, before Claude names it, with what the call says so far (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();

        const early = tracker.observeToolUse("tool-a1", "Agent", {});
        const complete = tracker.observeToolUse("tool-a1", "Agent", {
          description: "Count words",
          prompt: "Count the words in Welcome.md",
          subagent_type: "general-purpose",
          run_in_background: false,
        });

        expect(early).toEqual([
          {
            sessionUpdate: "task_started",
            toolCallId: "tool-a1",
            kind: "subagent",
            description: "",
          },
        ]);
        expect(complete).toEqual([
          {
            sessionUpdate: "task_started",
            toolCallId: "tool-a1",
            kind: "subagent",
            description: "Count words",
            prompt: "Count the words in Welcome.md",
            subagentType: "general-purpose",
          },
        ]);
      });

      it("reports a launch once when the same tool call is seen again unchanged", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.observeToolUse("tool-a1", "Agent", { description: "Count words" });

        expect(tracker.observeToolUse("tool-a1", "Agent", { description: "Count words" })).toEqual(
          []
        );
      });

      it(`reports a Bash call as a task only once its input asks for the background (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();

        expect(tracker.observeToolUse("tool-b1", "Bash", { command: "ls" })).toEqual([]);
        expect(
          tracker.observeToolUse("tool-b2", "Bash", {
            command: "npm run render",
            description: "Render",
            run_in_background: true,
          })
        ).toEqual([
          {
            sessionUpdate: "task_started",
            toolCallId: "tool-b2",
            kind: "command",
            description: "Render",
            command: "npm run render",
          },
        ]);
      });

      it(`attaches Claude's task id to a launched task and keeps the prompt the launch carried (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.observeToolUse("tool-a1", "Agent", {
          description: "Count words",
          prompt: "Count the words",
        });

        const start = tracker.accept(started("a1", { description: undefined, prompt: undefined }));

        expect(start).toEqual([
          expect.objectContaining({
            taskId: "a1",
            toolCallId: "tool-a1",
            description: "Count words",
            prompt: "Count the words",
          }),
        ]);
        expect(tracker.observeToolUse("tool-a1", "Agent", { description: "Changed" })).toEqual([]);
      });

      it(`reports no launch for a tool call whose task Claude already started (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));

        expect(tracker.observeToolUse("tool-a1", "Agent", { description: "Task a1" })).toEqual([]);
      });

      it(`puts the Bash command that launched a background command on its start (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.observeToolUse("tool-b1", "Bash", {
          command: "npm run render",
          description: "Render",
        });

        const start = tracker.accept(started("b1", { task_type: "local_bash" }));

        expect(start).toEqual([
          expect.objectContaining({ kind: "command", command: "npm run render" }),
        ]);
      });

      it("gives a subagent no command even when its tool input has one", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.observeToolUse("tool-a1", "Agent", { command: "not a shell command" });

        const [start] = tracker.accept(started("a1"));

        expect(start).not.toHaveProperty("command");
      });
    });

    describe("observeLaunchResult()", () => {
      it(`reports a running command's output file from its launch result (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("b1", { task_type: "local_bash" }));

        const updates = tracker.observeLaunchResult({ backgroundTaskId: "b1" }, LAUNCH_TEXT);

        expect(updates).toEqual([
          {
            sessionUpdate: "task_progress",
            taskId: "b1",
            outputFile: "/tmp/claude/s1/tasks/b1.output",
          },
        ]);
      });

      it(`keeps a whole output path that contains spaces (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("b1", { task_type: "local_bash" }));

        const updates = tracker.observeLaunchResult(
          { backgroundTaskId: "b1" },
          "Command running in background with ID: b1. Output is being written to: /Users/me/My Vault/.claude/tasks/b1.output. You will be notified when it completes."
        );

        expect(updates).toEqual([
          {
            sessionUpdate: "task_progress",
            taskId: "b1",
            outputFile: "/Users/me/My Vault/.claude/tasks/b1.output",
          },
        ]);
      });

      it("reports nothing for an unknown task, a finished task, or text without an output path", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("b1", { task_type: "local_bash" }));
        tracker.accept(started("b2", { task_type: "local_bash" }));
        tracker.accept(notification("b2"));

        expect(tracker.observeLaunchResult({ backgroundTaskId: "b9" }, LAUNCH_TEXT)).toEqual([]);
        expect(tracker.observeLaunchResult({ backgroundTaskId: "b2" }, LAUNCH_TEXT)).toEqual([]);
        expect(tracker.observeLaunchResult({ backgroundTaskId: "b1" }, "Started.")).toEqual([]);
      });
    });

    describe("observeSubagentModel()", () => {
      it(`reports a subagent's model once, and again only when it changes (${ISSUE_749})`, () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));

        const first = tracker.observeSubagentModel("tool-a1", "claude-haiku-9");
        const repeat = tracker.observeSubagentModel("tool-a1", "claude-haiku-9");
        const changed = tracker.observeSubagentModel("tool-a1", "claude-opus-9");

        expect(first).toEqual([
          { sessionUpdate: "task_progress", taskId: "a1", model: "claude-haiku-9" },
        ]);
        expect(repeat).toEqual([]);
        expect(changed).toEqual([
          { sessionUpdate: "task_progress", taskId: "a1", model: "claude-opus-9" },
        ]);
      });

      it("reports nothing without a model or for a tool call that launched no task", () => {
        const tracker = new ClaudeTaskTracker();
        tracker.accept(started("a1"));

        expect(tracker.observeSubagentModel("tool-a1", undefined)).toEqual([]);
        expect(tracker.observeSubagentModel("tool-zz", "claude-haiku-9")).toEqual([]);
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

    describe("launchAcknowledgedBy()", () => {
      it.each([
        ["a background subagent", { isAsync: true, status: "async_launched", agentId: "a1" }],
        ["a workflow", { status: "async_launched", taskId: "a1" }],
        ["a background command", { stdout: "", backgroundTaskId: "a1" }],
      ])(
        `picks the started task's own result out of a batch for the launch result of %s (${ISSUE_175})`,
        (_name, result) => {
          const tracker = new ClaudeTaskTracker();
          tracker.accept(started("a1"));

          expect(tracker.launchAcknowledgedBy(result, ["tool-read", "tool-a1"])).toBe("tool-a1");
        }
      );

      it("takes a lone result as the acknowledgement when the launch arrives before its task starts", () => {
        const tracker = new ClaudeTaskTracker();

        expect(tracker.launchAcknowledgedBy({ isAsync: true, agentId: "a1" }, ["tool-a1"])).toBe(
          "tool-a1"
        );
      });

      it("names no acknowledgement when an unstarted launch shares its batch", () => {
        const tracker = new ClaudeTaskTracker();

        expect(
          tracker.launchAcknowledgedBy({ isAsync: true, agentId: "a1" }, ["tool-read", "tool-a1"])
        ).toBeUndefined();
      });

      it("names no acknowledgement for a finished tool's result", () => {
        const tracker = new ClaudeTaskTracker();

        expect(
          tracker.launchAcknowledgedBy({ stdout: "done", stderr: "" }, ["tool-a1"])
        ).toBeUndefined();
        expect(tracker.launchAcknowledgedBy(undefined, ["tool-a1"])).toBeUndefined();
      });
    });
  });
});
