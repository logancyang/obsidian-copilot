import type { AgentPlanEntry, SessionUpdate } from "@/agentMode/session/types";

const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

type TodoStatus = AgentPlanEntry["status"];

function asTodoStatus(value: unknown): TodoStatus | null {
  return TODO_STATUSES.includes(value as TodoStatus) ? (value as TodoStatus) : null;
}

export interface ClaudeTaskPlanState {
  pendingCreatesByToolUseId: Map<string, { subject: string }>;
  tasksById: Map<string, { subject: string; status: TodoStatus; order: number }>;
  nextOrder: number;
  lastSignature: string | null;
}

export function createClaudeTaskPlanState(): ClaudeTaskPlanState {
  return {
    pendingCreatesByToolUseId: new Map(),
    tasksById: new Map(),
    nextOrder: 0,
    lastSignature: null,
  };
}

export function planUpdateFromClaudeToolUse(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  toolName: string,
  rawInput: unknown
): SessionUpdate | null {
  const input = isRecord(rawInput) ? rawInput : null;
  switch (toolName) {
    case "TodoWrite": {
      const todos = input?.todos;
      if (!Array.isArray(todos)) return null;
      const entries: AgentPlanEntry[] = [];
      for (const todo of todos) {
        if (!isRecord(todo)) continue;
        const status = asTodoStatus(todo.status);
        if (typeof todo.content !== "string" || todo.content.length === 0 || !status) continue;
        entries.push({ content: todo.content, status, priority: "medium" });
      }
      if (entries.length === 0 && todos.length > 0) return null;
      return emitIfChanged(state, entries);
    }
    case "TaskCreate": {
      const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
      if (!subject) return null;
      state.pendingCreatesByToolUseId.set(toolUseId, { subject });
      return null;
    }
    case "TaskUpdate": {
      const taskId = typeof input?.taskId === "string" ? input.taskId : "";
      if (!taskId) return null;
      if (input?.status === "deleted") {
        if (!state.tasksById.delete(taskId)) return null;
        return emitIfChanged(state, snapshotEntries(state));
      }
      const status = asTodoStatus(input?.status);
      const task = state.tasksById.get(taskId);
      if (!task || !status || task.status === status) return null;
      task.status = status;
      return emitIfChanged(state, snapshotEntries(state));
    }
    default:
      return null;
  }
}

export function planUpdateFromClaudeToolResult(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  content: unknown
): SessionUpdate | null {
  const pending = state.pendingCreatesByToolUseId.get(toolUseId);
  if (!pending) return null;
  state.pendingCreatesByToolUseId.delete(toolUseId);
  const result = readTaskCreateResult(content);
  if (!result) return null;
  if (isGroupFullyCompleted(state)) {
    state.tasksById.clear();
    state.nextOrder = 0;
  }
  state.tasksById.set(result.id, {
    subject: result.subject ?? pending.subject,
    status: "pending",
    order: state.nextOrder++,
  });
  return emitIfChanged(state, snapshotEntries(state));
}

function isGroupFullyCompleted(state: ClaudeTaskPlanState): boolean {
  if (state.tasksById.size === 0) return false;
  for (const task of state.tasksById.values()) {
    if (task.status !== "completed") return false;
  }
  return true;
}

function snapshotEntries(state: ClaudeTaskPlanState): AgentPlanEntry[] {
  return Array.from(state.tasksById.values())
    .sort((a, b) => a.order - b.order)
    .map((task) => ({ content: task.subject, status: task.status, priority: "medium" as const }));
}

function emitIfChanged(
  state: ClaudeTaskPlanState,
  entries: AgentPlanEntry[]
): SessionUpdate | null {
  const signature = JSON.stringify(entries);
  if (signature === state.lastSignature) return null;
  state.lastSignature = signature;
  return { sessionUpdate: "plan", entries };
}

function readTaskCreateResult(content: unknown): { id: string; subject?: string } | null {
  const direct = readTaskShape(content);
  if (direct) return direct;
  if (typeof content === "string") {
    return readTaskShape(tryParse(content)) ?? readTaskTextResult(content);
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
      const parsed = readTaskShape(tryParse(block.text)) ?? readTaskTextResult(block.text);
      if (parsed) return parsed;
    }
  }
  return null;
}

const TASK_CREATED_RE = /^Task #(\d+) created successfully\b/;

function readTaskTextResult(text: string): { id: string } | null {
  const match = TASK_CREATED_RE.exec(text.trim());
  return match ? { id: match[1] } : null;
}

function readTaskShape(value: unknown): { id: string; subject?: string } | null {
  if (!isRecord(value) || !isRecord(value.task)) return null;
  const { id, subject } = value.task;
  if (typeof id !== "string" || id.length === 0) return null;
  return { id, subject: typeof subject === "string" ? subject : undefined };
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
