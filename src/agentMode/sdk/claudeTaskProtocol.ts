import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentToolProgress,
  SessionUpdate,
  TaskEnd,
  TaskEndStatus,
  TaskKind,
  TaskStart,
} from "@/agentMode/session/types";

interface TrackedTask {
  start?: TaskStart;
  background: boolean;
  announced: boolean;
  ended: boolean;
  model?: string;
}

interface TaskFrame {
  subtype?: string;
  task_id?: unknown;
  tool_use_id?: unknown;
  task_type?: unknown;
  is_backgrounded?: unknown;
  ambient?: unknown;
  skip_transcript?: unknown;
  description?: unknown;
  prompt?: unknown;
  subagent_type?: unknown;
  status?: unknown;
  summary?: unknown;
  output_file?: unknown;
  usage?: unknown;
  last_tool_name?: unknown;
  patch?: unknown;
}

const NO_UPDATES: readonly SessionUpdate[] = Object.freeze([]);
const OUTPUT_FILE_IN_LAUNCH_TEXT = /Output is being written to: (.+?)\.(?:\s|$)/;

// Claude reports subagents and background commands as task frames whose order varies: an end can
// precede its start, and a foreground command only becomes a task once it moves to the background.
// Each task's start and end are reported once. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
export class ClaudeTaskTracker {
  private readonly tasks = new Map<string, TrackedTask>();
  private readonly earlyEnds = new Map<string, TaskEnd>();
  private readonly commands = new Map<string, string>();
  private readonly launches = new Map<string, TaskStart>();

  // A subagent or background command is a task from its tool call on, long before Claude reports it started. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  observeToolUse(toolUseId: string, name: string, input: unknown): readonly SessionUpdate[] {
    const command = name === "Bash" ? nonEmptyString(asRecord(input)?.command) : undefined;
    if (command) this.commands.set(toolUseId, command);
    const launch = taskLaunch(toolUseId, name, input);
    if (!launch || this.hasTaskFor(toolUseId)) return NO_UPDATES;
    const previous = this.launches.get(toolUseId);
    if (previous && JSON.stringify(previous) === JSON.stringify(launch)) return NO_UPDATES;
    this.launches.set(toolUseId, launch);
    return [{ sessionUpdate: "task_started", ...launch }];
  }

  // A background command's launch result is the only frame that names its output file while it runs. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  observeLaunchResult(toolUseResult: unknown, text: string): readonly SessionUpdate[] {
    const taskId = nonEmptyString(asRecord(toolUseResult)?.backgroundTaskId);
    const outputFile = OUTPUT_FILE_IN_LAUNCH_TEXT.exec(text)?.[1];
    const task = taskId ? this.tasks.get(taskId) : undefined;
    if (!taskId || !outputFile || !task?.announced || task.ended) return NO_UPDATES;
    return [{ sessionUpdate: "task_progress", taskId, outputFile }];
  }

  // A subagent's model is named only on its own assistant frames. https://github.com/Brevilabs/obsidian-copilot-private/issues/749
  observeSubagentModel(toolCallId: string, model: string | undefined): readonly SessionUpdate[] {
    if (!model) return NO_UPDATES;
    for (const [taskId, task] of this.tasks) {
      if (task.start?.toolCallId !== toolCallId) continue;
      if (!task.announced || task.ended || task.model === model) return NO_UPDATES;
      task.model = model;
      return [{ sessionUpdate: "task_progress", taskId, model }];
    }
    return NO_UPDATES;
  }

  accept(message: SDKMessage): readonly SessionUpdate[] {
    if (message.type !== "system") return NO_UPDATES;
    const frame = message as TaskFrame;
    const taskId = nonEmptyString(frame.task_id);
    if (!taskId) return NO_UPDATES;
    switch (frame.subtype) {
      case "task_started":
        return this.start(taskId, frame);
      case "task_progress":
        return this.progress(taskId, readTaskProgress(frame));
      case "task_updated":
        return asRecord(frame.patch)?.is_backgrounded === true
          ? this.moveToBackground(taskId)
          : NO_UPDATES;
      case "task_notification":
        return this.end(taskId, frame);
      default:
        return NO_UPDATES;
    }
  }

  private hasTaskFor(toolCallId: string): boolean {
    for (const task of this.tasks.values()) if (task.start?.toolCallId === toolCallId) return true;
    return false;
  }

  isRunningInBackground(toolCallId: string): boolean {
    for (const task of this.tasks.values()) {
      if (task.start?.toolCallId === toolCallId) return task.background && !task.ended;
    }
    return false;
  }

  launchAcknowledgedBy(
    toolUseResult: unknown,
    resultToolCallIds: readonly string[]
  ): string | undefined {
    if (!isAsyncLaunchResult(toolUseResult)) return undefined;
    const taskId = launchedTaskId(toolUseResult);
    const launch = taskId ? this.tasks.get(taskId)?.start?.toolCallId : undefined;
    if (launch) return resultToolCallIds.includes(launch) ? launch : undefined;
    return resultToolCallIds.length === 1 ? resultToolCallIds[0] : undefined;
  }

  stopRunning(): readonly SessionUpdate[] {
    const updates: SessionUpdate[] = [];
    for (const [taskId, task] of this.tasks) {
      if (task.ended) continue;
      task.ended = true;
      if (task.announced) updates.push({ sessionUpdate: "task_ended", taskId, status: "stopped" });
    }
    return updates;
  }

  private start(taskId: string, frame: TaskFrame): readonly SessionUpdate[] {
    if (frame.ambient === true || frame.skip_transcript === true) return NO_UPDATES;
    const toolCallId = nonEmptyString(frame.tool_use_id);
    const kind: TaskKind = frame.task_type === "local_agent" ? "subagent" : "command";
    const launch = toolCallId ? this.launches.get(toolCallId) : undefined;
    if (toolCallId) this.launches.delete(toolCallId);
    const task: TrackedTask = {
      start: toolCallId
        ? {
            taskId,
            toolCallId,
            kind,
            description: nonEmptyString(frame.description) ?? launch?.description ?? "",
            ...optional("prompt", nonEmptyString(frame.prompt) ?? launch?.prompt),
            ...optional(
              "subagentType",
              nonEmptyString(frame.subagent_type) ?? launch?.subagentType
            ),
            ...optional("command", kind === "command" ? this.commands.get(toolCallId) : undefined),
          }
        : undefined,
      background: frame.is_backgrounded !== false,
      announced: false,
      ended: false,
    };
    this.tasks.set(taskId, task);
    const updates = [...this.announce(task)];
    const earlyEnd = this.earlyEnds.get(taskId);
    if (earlyEnd) {
      this.earlyEnds.delete(taskId);
      updates.push(...this.finish(task, earlyEnd));
    }
    return updates;
  }

  private moveToBackground(taskId: string): readonly SessionUpdate[] {
    const task = this.tasks.get(taskId);
    if (!task || task.ended) return NO_UPDATES;
    task.background = true;
    return this.announce(task);
  }

  private announce(task: TrackedTask): readonly SessionUpdate[] {
    if (task.announced || !task.start) return NO_UPDATES;
    if (task.start.kind === "command" && !task.background) return NO_UPDATES;
    task.announced = true;
    return [{ sessionUpdate: "task_started", ...task.start }];
  }

  private progress(
    taskId: string,
    progress: AgentToolProgress | undefined
  ): readonly SessionUpdate[] {
    const task = this.tasks.get(taskId);
    if (!progress || !task?.announced || task.ended) return NO_UPDATES;
    return [{ sessionUpdate: "task_progress", taskId, progress }];
  }

  private end(taskId: string, frame: TaskFrame): readonly SessionUpdate[] {
    const status = taskEndStatus(frame.status);
    if (!status) return this.progress(taskId, readTaskProgress(frame));
    const end: TaskEnd = {
      taskId,
      status,
      ...optional("summary", nonEmptyString(frame.summary)),
      ...optional("outputFile", nonEmptyString(frame.output_file)),
    };
    const task = this.tasks.get(taskId);
    if (!task) {
      this.earlyEnds.set(taskId, end);
      return NO_UPDATES;
    }
    return [...this.progress(taskId, readTaskProgress(frame)), ...this.finish(task, end)];
  }

  private finish(task: TrackedTask, end: TaskEnd): readonly SessionUpdate[] {
    if (task.ended) return NO_UPDATES;
    task.ended = true;
    return task.announced ? [{ sessionUpdate: "task_ended", ...end }] : NO_UPDATES;
  }
}

function launchedTaskId(toolUseResult: unknown): string | undefined {
  const result = asRecord(toolUseResult);
  return (
    nonEmptyString(result?.agentId) ??
    nonEmptyString(result?.taskId) ??
    nonEmptyString(result?.backgroundTaskId)
  );
}

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

function taskLaunch(toolCallId: string, name: string, input: unknown): TaskStart | undefined {
  const fields = asRecord(input);
  const description = nonEmptyString(fields?.description) ?? "";
  if (SUBAGENT_TOOLS.has(name)) {
    return {
      toolCallId,
      kind: "subagent",
      description,
      ...optional("prompt", nonEmptyString(fields?.prompt)),
      ...optional("subagentType", nonEmptyString(fields?.subagent_type)),
    };
  }
  if (name === "Bash" && fields?.run_in_background === true) {
    return {
      toolCallId,
      kind: "command",
      description,
      ...optional("command", nonEmptyString(fields.command)),
    };
  }
  return undefined;
}

function isAsyncLaunchResult(toolUseResult: unknown): boolean {
  const result = asRecord(toolUseResult);
  return (
    result?.isAsync === true ||
    result?.status === "async_launched" ||
    nonEmptyString(result?.backgroundTaskId) !== undefined
  );
}

function taskEndStatus(status: unknown): TaskEndStatus | undefined {
  switch (status) {
    case "completed":
    case "failed":
    case "stopped":
      return status;
    default:
      return undefined;
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTaskProgress(frame: TaskFrame): AgentToolProgress | undefined {
  const usage = asRecord(frame.usage);
  const progress: AgentToolProgress = {
    ...optional(
      "description",
      frame.subtype === "task_progress" ? nonEmptyString(frame.description) : undefined
    ),
    ...optional("toolName", nonEmptyString(frame.last_tool_name)),
    ...optional("toolUses", finiteNumber(usage?.tool_uses)),
    ...optional("durationMs", finiteNumber(usage?.duration_ms)),
    ...optional("totalTokens", finiteNumber(usage?.total_tokens)),
  };
  return Object.keys(progress).length > 0 ? progress : undefined;
}
