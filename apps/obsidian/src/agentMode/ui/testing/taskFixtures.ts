import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { TaskOutputReader } from "@/agentMode/session/taskOutputTail";

export function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-1",
    toolCallId: "call-1",
    kind: "subagent",
    description: "Count words in Welcome",
    subagentType: "general-purpose",
    status: "running",
    ...overrides,
  };
}

export function makeCommandTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return makeTask({
    taskId: "task-2",
    toolCallId: "call-2",
    kind: "command",
    description: "Print 30 progress lines",
    subagentType: undefined,
    command: "for i in $(seq 1 30); do echo line $i; sleep 1; done",
    outputFile: "/tmp/tasks/task-2.output",
    ...overrides,
  });
}

export function textOutputReader(files: Record<string, string>): () => TaskOutputReader {
  const bytes = (path: string) =>
    path in files ? new TextEncoder().encode(files[path]) : undefined;
  const reader: TaskOutputReader = {
    size: async (path) => bytes(path)?.length ?? null,
    read: async (path, start, length) =>
      (bytes(path) ?? new Uint8Array()).slice(start, start + length),
  };
  return () => reader;
}
