/**
 * Normalizes Claude's execution todo list into the session-domain `plan`
 * update — the same shape the ACP backends deliver — so the trail's PlanPill
 * and the project-info Progress section stay backend- and version-agnostic.
 *
 * The Claude runtime ships TWO wire shapes, decided by the user's installed
 * `claude` CLI (not by our pinned npm SDK):
 *  - `TodoWrite` (CLI < 2.1.142, or `CLAUDE_CODE_ENABLE_TASKS=0`): one call
 *    carrying the WHOLE list in `input.todos`.
 *  - Task tools (CLI >= 2.1.142, the default): `TaskCreate` per item, the
 *    task id arriving in the matching `tool_result`. The id is the `#N`
 *    ordinal: real CLIs return the human-readable string
 *    `"Task #N created successfully: <subject>"` (a `{task:{id,subject}}`
 *    object/JSON is also accepted for forward-compat). Then
 *    `TaskUpdate {taskId, status}` references that same `N`.
 * Both converge here; display text is the stable title field (`content` /
 * `subject`), deliberately NOT `activeForm` (per-status text would make the
 * same entry's label jump between states and differ across shapes).
 *
 * State is held PER CLAUDE SESSION (not per query): Task ids created in turn
 * 1 must still resolve when turn 2's `TaskUpdate` references them, and the
 * translator's own state is rebuilt for every `query()` call.
 */
import type { AgentPlanEntry, SessionUpdate } from "@/agentMode/session/types";

const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

type TodoStatus = AgentPlanEntry["status"];

function asTodoStatus(value: unknown): TodoStatus | null {
  return TODO_STATUSES.includes(value as TodoStatus) ? (value as TodoStatus) : null;
}

export interface ClaudeTaskPlanState {
  /** TaskCreate inputs waiting for their tool_result to deliver the task id. */
  pendingCreatesByToolUseId: Map<string, { subject: string }>;
  tasksById: Map<string, { subject: string; status: TodoStatus; order: number }>;
  nextOrder: number;
  /**
   * Signature of the last emitted entries — suppresses re-emits when the
   * multiple translator injection points (stream delta, block stop, assistant
   * fallback) observe the same final input.
   */
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

/**
 * Feed one native, top-level tool_use (TodoWrite / TaskCreate / TaskUpdate).
 * Callers are responsible for the native + top-level filter (no `mcpServer`,
 * `parent_tool_use_id == null`) — subagent todos must not pollute the
 * session-level list. Returns a `plan` update when the canonical list
 * changed, else null.
 */
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
      // A genuinely empty list (`todos: []`) is a clear — emit it so the
      // snapshot resets, matching the Task-tools path (deleting the last task
      // emits an empty plan). But a NON-empty array that filtered down to
      // nothing is malformed input, not a clear: don't wipe a good list on garbage.
      if (entries.length === 0 && todos.length > 0) return null;
      return emitIfChanged(state, entries);
    }
    case "TaskCreate": {
      const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
      if (!subject) return null;
      // No emission yet — the entry joins the list once the tool_result
      // delivers its id (which also implicitly scopes results to top-level
      // creates: subagent results never match this map).
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
      // Unknown id (e.g. created by a subagent, or a pre-resume task) is
      // ignored rather than fabricated — we'd have no subject to show.
      if (!task || !status || task.status === status) return null;
      task.status = status;
      return emitIfChanged(state, snapshotEntries(state));
    }
    default:
      return null;
  }
}

/**
 * Feed one tool_result. Only results matching a pending TaskCreate bind an
 * id; everything else is ignored. The result content arrives in several
 * observed shapes: the plain string `"Task #N created successfully: ..."`
 * (real CLI), a `{task:{id,subject}}` object, a JSON string of it, or a
 * `[{type:"text", text:"..."}]` block list wrapping either form.
 */
export function planUpdateFromClaudeToolResult(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  content: unknown
): SessionUpdate | null {
  const pending = state.pendingCreatesByToolUseId.get(toolUseId);
  if (!pending) return null;
  // Consume the pending entry up front: a tool_use id's result arrives exactly
  // once, so whether we can parse it or not, the pending record is spent —
  // dropping it here stops failed/unparseable results from accumulating over a
  // long session. Callers pass `null` content for an is_error result, which
  // lands here as "consume but emit nothing".
  state.pendingCreatesByToolUseId.delete(toolUseId);
  const result = readTaskCreateResult(content);
  if (!result) return null;
  // Official Todo lifecycle step 4 ("Removed when all tasks in a group are
  // completed"): a finished group must not linger once the next one starts.
  // When this newly-bound create lands while every existing task is already
  // completed, it is the first task of a NEW group (e.g. a second topic in the
  // same claude session) — drop the old group so they don't stack. The check
  // self-batches: once this pending task is in the map the group is no longer
  // all-completed, so the rest of the batch appends instead of wiping.
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

/** True only for a non-empty list whose every task has reached `completed`. */
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

/**
 * Layer 1 of 3 in the todo-plan dedup chain — the EMIT layer (claude only):
 * the SDK translator feeds the same final tool input from several injection
 * points (content_block stream delta, block stop, assistant fallback), so
 * signature-compare here collapses them to one `plan` update. The downstream
 * layers are NOT redundant: `AgentSession.applyCurrentTodoList` dedups the
 * live snapshot's change notifications, and `planEntriesEqual`
 * (AgentMessageStore) dedups the rendered plan message part.
 */
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

// The task id is the `#N` ordinal — the same value TaskUpdate later sends as
// `taskId`. We deliberately bind ONLY the id, not the echoed subject: the
// authoritative subject is the tool_use's `input.subject` (already stashed in
// the pending record), while this text is a localizable, possibly-truncated
// echo. `readTaskCreateResult` falls back to the pending subject when this
// returns no subject.
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
