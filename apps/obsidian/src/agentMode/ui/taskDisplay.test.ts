import type { PermissionPrompt } from "@/agentMode/session/types";
import {
  permissionRequesterName,
  runningTasks,
  taskBadgeStatus,
  taskDisplayStatus,
  taskKindLabel,
  taskLabel,
  taskStatusLabel,
  taskTitle,
} from "@/agentMode/ui/taskDisplay";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";

function permission(requester: PermissionPrompt["requester"]): PermissionPrompt {
  return {
    sessionId: "s",
    requester,
    toolCall: { toolCallId: "perm-1", title: "Bash" },
    options: [],
  };
}

describe("taskDisplay", () => {
  describe("taskTitle()", () => {
    it("uses the task's description, then its subagent type, then its command", () => {
      expect(taskTitle(makeTask())).toBe("Count words in Welcome");
      expect(taskTitle(makeTask({ description: "" }))).toBe("general-purpose");
      expect(taskTitle(makeCommandTask({ description: "" }))).toBe(
        "for i in $(seq 1 30); do echo line $i; sleep 1; done"
      );
      expect(taskTitle(makeTask({ description: "", subagentType: undefined }))).toBe("Task");
    });
  });

  describe("taskLabel()", () => {
    it(`names a subagent by its type and description, and by its type alone while its launch has no description yet (${ISSUE_749})`, () => {
      expect(taskLabel(makeTask())).toBe("general-purpose · Count words in Welcome");
      expect(taskLabel(makeTask({ description: "", subagentType: undefined }))).toBe("Subagent");
      expect(taskLabel(makeCommandTask())).toBe("Print 30 progress lines");
    });
  });

  describe("taskKindLabel()", () => {
    it("names a command a command and a subagent by its type, or Subagent without one", () => {
      expect(taskKindLabel(makeCommandTask())).toBe("Command");
      expect(taskKindLabel(makeTask())).toBe("general-purpose");
      expect(taskKindLabel(makeTask({ subagentType: undefined }))).toBe("Subagent");
    });
  });

  describe("taskStatusLabel()", () => {
    it("labels every status in words", () => {
      expect(
        (["running", "needs_approval", "completed", "failed", "stopped"] as const).map(
          taskStatusLabel
        )
      ).toEqual(["Running", "Needs approval", "Completed", "Failed", "Stopped"]);
    });
  });

  describe("taskBadgeStatus()", () => {
    it("shows running work as in progress, approval as pending, and a stopped task with the stop mark", () => {
      expect(taskBadgeStatus("running")).toBe("in_progress");
      expect(taskBadgeStatus("needs_approval")).toBe("pending");
      expect(taskBadgeStatus("completed")).toBe("completed");
      expect(taskBadgeStatus("failed")).toBe("failed");
      expect(taskBadgeStatus("stopped")).toBe("cancelled");
    });
  });

  describe("runningTasks()", () => {
    it(`counts running subagents and background commands and leaves out ended tasks (${ISSUE_749})`, () => {
      const tasks = [
        makeTask(),
        makeCommandTask(),
        makeTask({ taskId: "done", status: "completed" }),
        makeTask({ taskId: "stopped", status: "stopped" }),
      ];

      expect(runningTasks(tasks).map((t) => t.taskId)).toEqual(["task-1", "task-2"]);
    });
  });

  describe("taskDisplayStatus()", () => {
    it(`shows a running task that is waiting on its own permission request as needing approval (${ISSUE_749})`, () => {
      const task = makeTask();

      expect(taskDisplayStatus(task, [permission({ taskId: "task-1" })])).toBe("needs_approval");
      expect(taskDisplayStatus(task, [permission({ taskId: "other" })])).toBe("running");
      expect(taskDisplayStatus(task, [permission("main")])).toBe("running");
    });

    it("shows an ended task's own status even with a request still listed", () => {
      expect(
        taskDisplayStatus(makeTask({ status: "failed" }), [permission({ taskId: "task-1" })])
      ).toBe("failed");
    });
  });

  describe("permissionRequesterName()", () => {
    it(`names the task that asked for a permission (${ISSUE_749})`, () => {
      expect(permissionRequesterName(permission({ taskId: "task-1" }), [makeTask()])).toBe(
        'general-purpose "Count words in Welcome"'
      );
    });

    it("names no one for the main agent or a task it does not know", () => {
      expect(permissionRequesterName(permission("main"), [makeTask()])).toBeUndefined();
      expect(permissionRequesterName(permission(undefined), [makeTask()])).toBeUndefined();
      expect(permissionRequesterName(permission({ taskId: "gone" }), [makeTask()])).toBeUndefined();
    });
  });
});
