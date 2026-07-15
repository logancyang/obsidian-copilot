/**
 * @fileoverview Owns Claude background-task identity, correlation, and terminal merging.
 *
 * One logical task has two identities whose carriers may arrive out of order:
 * `L`, the Agent/Task launch tool-call ID, and `T`, Claude's task ID. The launch
 * moves through awaiting identity, active, terminal without output, and terminal
 * with output. Identity remains one-to-one and terminal status never regresses.
 * Keeping those rules behind one query-owned interface prevents the translator
 * from coordinating maps whose invariants can drift apart.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentToolProgress,
  AgentToolStatus,
  ToolCallContent,
} from "@/agentMode/session/types";

interface AwaitingBackgroundTaskIdentity {
  phase: "awaiting_identity";
  toolCallId: string;
}

interface ActiveBackgroundTaskLaunch {
  phase: "active";
  toolCallId: string;
  taskId: string;
}

interface TerminalBackgroundTaskWithoutOutput {
  phase: "terminal_without_output";
  toolCallId: string;
  taskId: string;
  terminalStatus: TerminalTaskStatus;
}

interface TerminalBackgroundTaskWithOutput {
  phase: "terminal_with_output";
  toolCallId: string;
  taskId: string;
  terminalStatus: TerminalTaskStatus;
  output: string;
}

type IdentifiedBackgroundTaskLaunch =
  | ActiveBackgroundTaskLaunch
  | TerminalBackgroundTaskWithoutOutput
  | TerminalBackgroundTaskWithOutput;

type BackgroundTaskLaunch = AwaitingBackgroundTaskIdentity | IdentifiedBackgroundTaskLaunch;

export type ClaudeTaskCarrier =
  | {
      kind: "tool_snapshot";
      toolCallId: string;
      nativeToolName?: string;
      input: unknown;
    }
  | { kind: "sdk_message"; message: SDKMessage }
  | { kind: "query_finished" };

export interface ClaudeTaskToolUpdate {
  toolCallId: string;
  status?: AgentToolStatus;
  content?: ToolCallContent[];
  progress?: AgentToolProgress;
}

export type ClaudeTaskResultAction = { kind: "omit" };

export interface ClaudeTaskDecision {
  updates: readonly ClaudeTaskToolUpdate[];
  resultActions: ReadonlyMap<string, ClaudeTaskResultAction>;
}

type TerminalTaskStatus = "completed" | "failed";

type ClaudeTaskProtocolEvent =
  | { kind: "launch_observed"; toolCallId: string }
  | {
      kind: "task_active";
      toolCallId?: string;
      taskId: string;
      progress?: AgentToolProgress;
    }
  | {
      kind: "task_terminal";
      toolCallId?: string;
      taskId: string;
      status: TerminalTaskStatus;
      output?: string;
      progress?: AgentToolProgress;
    }
  | {
      kind: "result_batch";
      resultIds: readonly string[];
      launchTaskId?: string;
    }
  | { kind: "query_finished" };

const EMPTY_TASK_UPDATES: readonly ClaudeTaskToolUpdate[] = Object.freeze([]);
const EMPTY_RESULT_ACTIONS: ReadonlyMap<string, ClaudeTaskResultAction> = new Map();
const NO_TASK_DECISION: ClaudeTaskDecision = Object.freeze({
  updates: EMPTY_TASK_UPDATES,
  resultActions: EMPTY_RESULT_ACTIONS,
});

/**
 * Reconciles Claude's background-task carriers into decisions for one SDK query.
 *
 * Callers submit carrier snapshots without coordinating their order. The
 * protocol owns identity correlation and monotonic transitions; callers only
 * project its decisions to session events.
 */
export class ClaudeBackgroundTaskStateMachine {
  private readonly launchesByToolCallId = new Map<string, BackgroundTaskLaunch>();
  private readonly launchToolCallIdByTaskId = new Map<string, string>();

  /**
   * Applies one carrier atomically and returns every resulting protocol decision.
   *
   * @param carrier A tool snapshot, SDK message, or query-lifecycle signal.
   */
  accept(carrier: ClaudeTaskCarrier): ClaudeTaskDecision {
    const protocolEvent = protocolEventFromCarrier(carrier);
    return protocolEvent ? this.transition(protocolEvent) : NO_TASK_DECISION;
  }

  private transition(protocolEvent: ClaudeTaskProtocolEvent): ClaudeTaskDecision {
    switch (protocolEvent.kind) {
      case "launch_observed":
        if (!this.launchesByToolCallId.has(protocolEvent.toolCallId)) {
          this.launchesByToolCallId.set(protocolEvent.toolCallId, {
            phase: "awaiting_identity",
            toolCallId: protocolEvent.toolCallId,
          });
        }
        return NO_TASK_DECISION;
      case "task_active":
        return this.transitionActiveTask(protocolEvent);
      case "task_terminal":
        return this.transitionTerminalTask(protocolEvent);
      case "result_batch":
        return this.transitionResultBatch(protocolEvent);
      case "query_finished":
        this.launchesByToolCallId.clear();
        this.launchToolCallIdByTaskId.clear();
        return NO_TASK_DECISION;
    }
  }

  private transitionActiveTask(
    protocolEvent: Extract<ClaudeTaskProtocolEvent, { kind: "task_active" }>
  ): ClaudeTaskDecision {
    const launch = this.resolveLaunch(protocolEvent.toolCallId, protocolEvent.taskId);
    if (!launch || isTerminalLaunch(launch)) return NO_TASK_DECISION;
    return taskDecision({
      toolCallId: launch.toolCallId,
      status: "in_progress",
      ...(protocolEvent.progress ? { progress: protocolEvent.progress } : {}),
    });
  }

  private transitionTerminalTask(
    protocolEvent: Extract<ClaudeTaskProtocolEvent, { kind: "task_terminal" }>
  ): ClaudeTaskDecision {
    const launch = this.resolveLaunch(protocolEvent.toolCallId, protocolEvent.taskId);
    if (!launch) return NO_TASK_DECISION;
    const update = this.mergeTerminal(
      launch,
      protocolEvent.status,
      protocolEvent.output,
      protocolEvent.progress
    );
    return update ? taskDecision(update) : NO_TASK_DECISION;
  }

  private transitionResultBatch(
    protocolEvent: Extract<ClaudeTaskProtocolEvent, { kind: "result_batch" }>
  ): ClaudeTaskDecision {
    const resultActions = new Map<string, ClaudeTaskResultAction>();
    const launchAckToolCallId = protocolEvent.launchTaskId
      ? this.launchAckOwner(protocolEvent.launchTaskId, protocolEvent.resultIds)
      : undefined;
    if (launchAckToolCallId) resultActions.set(launchAckToolCallId, { kind: "omit" });

    // Foreground Agent/Task results cannot receive future background frames.
    for (const toolCallId of protocolEvent.resultIds) {
      const launch = this.launchesByToolCallId.get(toolCallId);
      if (launch?.phase === "awaiting_identity" && toolCallId !== launchAckToolCallId) {
        this.launchesByToolCallId.delete(toolCallId);
      }
    }

    return resultActions.size === 0
      ? NO_TASK_DECISION
      : { updates: EMPTY_TASK_UPDATES, resultActions };
  }

  private bindLaunch(
    toolCallId: string,
    taskId: string
  ): IdentifiedBackgroundTaskLaunch | undefined {
    const launch = this.launchesByToolCallId.get(toolCallId);
    if (!launch) return undefined;
    if (launch.phase !== "awaiting_identity" && launch.taskId !== taskId) return undefined;
    const existing = this.launchToolCallIdByTaskId.get(taskId);
    if (existing && existing !== toolCallId) return undefined;
    const identified =
      launch.phase === "awaiting_identity"
        ? ({ phase: "active", toolCallId, taskId } satisfies ActiveBackgroundTaskLaunch)
        : launch;
    this.launchesByToolCallId.set(toolCallId, identified);
    this.launchToolCallIdByTaskId.set(taskId, toolCallId);
    return identified;
  }

  private resolveLaunch(
    toolCallId: string | undefined,
    taskId: string
  ): IdentifiedBackgroundTaskLaunch | undefined {
    const resolvedToolCallId = toolCallId ?? this.launchToolCallIdByTaskId.get(taskId);
    return resolvedToolCallId ? this.bindLaunch(resolvedToolCallId, taskId) : undefined;
  }

  private launchAckOwner(agentId: string, resultIds: readonly string[]): string | undefined {
    const known = this.launchToolCallIdByTaskId.get(agentId);
    if (known) return resultIds.includes(known) ? known : undefined;
    const candidates = resultIds.filter((toolCallId) => this.launchesByToolCallId.has(toolCallId));
    if (candidates.length !== 1) return undefined;
    return this.bindLaunch(candidates[0], agentId)?.toolCallId;
  }

  private mergeTerminal(
    launch: IdentifiedBackgroundTaskLaunch,
    status: TerminalTaskStatus,
    output?: string,
    progress?: AgentToolProgress
  ): ClaudeTaskToolUpdate | undefined {
    if (launch.phase === "terminal_with_output") return undefined;
    if (launch.phase === "terminal_without_output") {
      if (!output) return undefined;
      this.launchesByToolCallId.set(launch.toolCallId, {
        ...launch,
        phase: "terminal_with_output",
        output,
      });
      return {
        toolCallId: launch.toolCallId,
        status: launch.terminalStatus,
        content: textContent(output),
        ...(progress ? { progress } : {}),
      };
    }

    const terminalLaunch: TerminalBackgroundTaskWithoutOutput | TerminalBackgroundTaskWithOutput =
      output
        ? { ...launch, phase: "terminal_with_output", terminalStatus: status, output }
        : { ...launch, phase: "terminal_without_output", terminalStatus: status };
    this.launchesByToolCallId.set(launch.toolCallId, terminalLaunch);
    return {
      toolCallId: launch.toolCallId,
      status,
      ...(output ? { content: textContent(output) } : {}),
      ...(progress ? { progress } : {}),
    };
  }
}

function protocolEventFromCarrier(carrier: ClaudeTaskCarrier): ClaudeTaskProtocolEvent | undefined {
  if (carrier.kind === "query_finished") return carrier;

  if (carrier.kind === "tool_snapshot") {
    if (carrier.nativeToolName === "Agent" || carrier.nativeToolName === "Task") {
      return { kind: "launch_observed", toolCallId: carrier.toolCallId };
    }
    return undefined;
  }

  const message = carrier.message;
  if (message.type === "user") {
    return {
      kind: "result_batch",
      resultIds: toolResultIds(message),
      launchTaskId: readAsyncLaunchAgentId(message),
    };
  }
  if (message.type !== "system") return undefined;

  const frame = message as {
    subtype?: string;
    task_id?: string;
    tool_use_id?: string;
    status?: unknown;
    summary?: unknown;
    description?: unknown;
    last_tool_name?: unknown;
    usage?: unknown;
  };
  if (
    frame.subtype !== "task_started" &&
    frame.subtype !== "task_progress" &&
    frame.subtype !== "task_notification"
  ) {
    return undefined;
  }
  const taskId = nonEmptyString(frame.task_id);
  const toolCallId = nonEmptyString(frame.tool_use_id);
  if (!taskId || (frame.tool_use_id !== undefined && !toolCallId)) return undefined;
  const progress = readTaskProgress(frame);
  if (frame.subtype !== "task_notification") {
    return {
      kind: "task_active",
      toolCallId,
      taskId,
      ...(frame.subtype === "task_progress" && progress ? { progress } : {}),
    };
  }
  const status = mapTerminalTaskStatus(frame.status);
  return status
    ? {
        kind: "task_terminal",
        toolCallId,
        taskId,
        status,
        output: nonEmptyString(frame.summary),
        ...(progress ? { progress } : {}),
      }
    : { kind: "task_active", toolCallId, taskId, ...(progress ? { progress } : {}) };
}

function taskDecision(update: ClaudeTaskToolUpdate): ClaudeTaskDecision {
  return { updates: [update], resultActions: EMPTY_RESULT_ACTIONS };
}

function isTerminalLaunch(
  launch: IdentifiedBackgroundTaskLaunch
): launch is TerminalBackgroundTaskWithoutOutput | TerminalBackgroundTaskWithOutput {
  return launch.phase === "terminal_without_output" || launch.phase === "terminal_with_output";
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

function toolResultIds(msg: SDKMessage): string[] {
  const content = asRecord((msg as { message?: unknown }).message)?.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record?.type !== "tool_result") continue;
    const id = nonEmptyString(record.tool_use_id);
    if (id) ids.push(id);
  }
  return ids;
}

function readTaskProgress(msg: {
  description?: unknown;
  last_tool_name?: unknown;
  usage?: unknown;
}): AgentToolProgress | undefined {
  const usage = asRecord(msg.usage);
  const description = nonEmptyString(msg.description);
  const toolName = nonEmptyString(msg.last_tool_name);
  const toolUses = finiteNumber(usage?.tool_uses);
  const durationMs = finiteNumber(usage?.duration_ms);
  const totalTokens = finiteNumber(usage?.total_tokens);
  if (
    description === undefined &&
    toolName === undefined &&
    toolUses === undefined &&
    durationMs === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(description ? { description } : {}),
    ...(toolName ? { toolName } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function textContent(text: string): ToolCallContent[] {
  return [{ type: "content", content: { type: "text", text } }];
}

function readAsyncLaunchAgentId(msg: SDKMessage): string | undefined {
  const result = asRecord((msg as { tool_use_result?: unknown }).tool_use_result);
  if (!result) return undefined;
  const isAsync = result.isAsync === true || nonEmptyString(result.status) === "async_launched";
  if (!isAsync) return undefined;
  return nonEmptyString(result.agentId);
}

function mapTerminalTaskStatus(status: unknown): TerminalTaskStatus | undefined {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "stopped":
      return "failed";
    default:
      return undefined;
  }
}
