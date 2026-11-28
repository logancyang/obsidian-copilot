export type TaskKind = "subagent" | "command";

export type TaskEndStatus = "completed" | "failed" | "stopped";

// A task is known from the tool call that launches it, before the agent assigns it an id: a launch reports no taskId, and a later task_started for the same toolCallId attaches it. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
export interface TaskStart {
  taskId?: string;
  toolCallId: string;
  kind: TaskKind;
  description: string;
  prompt?: string;
  subagentType?: string;
  command?: string;
}

export interface AgentTask extends TaskStart {
  status: "running" | TaskEndStatus;
  model?: string;
  outputFile?: string;
  summary?: string;
}
