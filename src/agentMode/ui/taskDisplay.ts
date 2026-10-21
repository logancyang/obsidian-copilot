import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentToolStatus, PermissionPrompt } from "@/agentMode/session/types";

export type TaskDisplayStatus = AgentTask["status"] | "needs_approval";

const STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  running: "Running",
  needs_approval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const BADGE_STATUS: Record<TaskDisplayStatus, AgentToolStatus> = {
  running: "in_progress",
  needs_approval: "pending",
  completed: "completed",
  failed: "failed",
  stopped: "cancelled",
};

export function taskTitle(task: AgentTask): string {
  return task.description || task.subagentType || task.command || "Task";
}

// A subagent is listed from its launch, before its description has streamed in. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export function taskLabel(task: AgentTask): string {
  if (task.kind === "command") return taskTitle(task);
  return [taskKindLabel(task), task.description].filter(Boolean).join(" · ");
}

export function taskKindLabel(task: AgentTask): string {
  if (task.kind === "command") return "Command";
  return task.subagentType ?? "Subagent";
}

export function taskStatusLabel(status: TaskDisplayStatus): string {
  return STATUS_LABELS[status];
}

export function taskBadgeStatus(status: TaskDisplayStatus): AgentToolStatus {
  return BADGE_STATUS[status];
}

export function runningTasks(tasks: readonly AgentTask[]): AgentTask[] {
  return tasks.filter((task) => task.status === "running");
}

export function taskDisplayStatus(
  task: AgentTask,
  permissions: readonly PermissionPrompt[]
): TaskDisplayStatus {
  if (task.status !== "running") return task.status;
  const asking = permissions.some(
    (p) => typeof p.requester === "object" && p.requester.taskId === task.taskId
  );
  return asking ? "needs_approval" : "running";
}

export function permissionRequesterName(
  request: PermissionPrompt,
  tasks: readonly AgentTask[]
): string | undefined {
  const requester = request.requester;
  if (typeof requester !== "object") return undefined;
  const task = tasks.find((t) => t.taskId === requester.taskId);
  return task ? `${taskKindLabel(task)} "${taskTitle(task)}"` : undefined;
}
