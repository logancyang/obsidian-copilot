/**
 * @fileoverview Owns Claude Agent/Task identity, lifecycle, and terminal output merging.
 *
 * One logical task has two identities whose carriers may arrive out of order:
 * `L`, the Agent/Task launch tool-call ID, and `T`, Claude's task ID. The launch
 * moves through awaiting identity, active, and terminal. Execution state and
 * output availability remain separate, identified correlation lasts for the
 * SDK session, and terminal status never regresses.
 * Keeping those rules behind one session-owned interface prevents the translator
 * from coordinating maps whose invariants can drift apart.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentToolProgress,
  AgentToolStatus,
  ToolCallContent,
} from "@/agentMode/session/types";

interface AwaitingTaskIdentity {
  phase: "awaiting_identity";
  toolCallId: string;
  candidateTaskId?: string;
}

interface ActiveTaskLaunch {
  phase: "active";
  toolCallId: string;
  taskId: string;
}

interface TerminalTaskLaunch {
  phase: "terminal";
  toolCallId: string;
  taskId?: string;
  terminalStatus: TerminalTaskStatus;
  outputAvailable: boolean;
}

type IdentifiedTaskLaunch = ActiveTaskLaunch | (TerminalTaskLaunch & { taskId: string });

type TaskLaunch = AwaitingTaskIdentity | ActiveTaskLaunch | TerminalTaskLaunch;

export type ClaudeTaskCarrier =
  | {
      kind: "tool_snapshot";
      toolCallId: string;
      nativeToolName?: string;
    }
  | { kind: "sdk_message"; message: SDKMessage };

export interface ClaudeTaskToolUpdate {
  toolCallId: string;
  status?: AgentToolStatus;
  content?: ToolCallContent[];
  progress?: AgentToolProgress;
}

type TerminalTaskStatus = "completed" | "failed";

export type ClaudeTaskResultAction =
  | { kind: "omit" }
  | { kind: "preserve_status"; status: TerminalTaskStatus };

export interface ClaudeTaskDecision {
  updates: readonly ClaudeTaskToolUpdate[];
  resultActions: ReadonlyMap<string, ClaudeTaskResultAction>;
}

interface ClaudeToolResultBlock {
  toolCallId: string;
  status: TerminalTaskStatus;
}

interface PendingTerminalFrame {
  status: TerminalTaskStatus;
  output?: string;
  progress?: AgentToolProgress;
}

type ClaudeTaskProtocolEvent =
  | {
      kind: "launch_observed";
      toolCallId: string;
    }
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
      results: readonly ClaudeToolResultBlock[];
      asyncLaunchTaskId?: string;
    };

const EMPTY_TASK_UPDATES: readonly ClaudeTaskToolUpdate[] = Object.freeze([]);
const EMPTY_RESULT_ACTIONS: ReadonlyMap<string, ClaudeTaskResultAction> = new Map();
const NO_TASK_DECISION: ClaudeTaskDecision = Object.freeze({
  updates: EMPTY_TASK_UPDATES,
  resultActions: EMPTY_RESULT_ACTIONS,
});

/**
 * Reconciles Claude Agent/Task carriers for one SDK session.
 *
 * Callers submit carrier snapshots without coordinating their order. The
 * protocol owns foreground and background identity correlation across query
 * boundaries plus monotonic execution state; callers only project its decisions
 * to session events.
 */
export class ClaudeBackgroundTaskStateMachine {
  private readonly launchesByToolCallId = new Map<string, TaskLaunch>();
  private readonly launchToolCallIdByTaskId = new Map<string, string>();
  // A fast task can settle with only its task id before the launch
  // acknowledgement supplies the binding; the frame is parked here and
  // replayed by `bindLaunch` the moment the identity arrives.
  private readonly pendingTerminalsByTaskId = new Map<string, PendingTerminalFrame>();
  private readonly replayedUpdates: ClaudeTaskToolUpdate[] = [];

  /**
   * Applies one carrier atomically and returns every resulting protocol decision.
   *
   * @param carrier A tool snapshot or SDK message from the owning session.
   */
  accept(carrier: ClaudeTaskCarrier): ClaudeTaskDecision {
    const protocolEvent = protocolEventFromCarrier(carrier);
    if (!protocolEvent) return NO_TASK_DECISION;
    const decision = this.transition(protocolEvent);
    if (this.replayedUpdates.length === 0) return decision;
    const replays = this.replayedUpdates.splice(0);
    return {
      updates: [...replays, ...decision.updates],
      resultActions: decision.resultActions,
    };
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
    if (!launch) {
      // Park only task-only frames: a frame carrying an explicit tool_use_id
      // that still fails to resolve refers to a launch this session never
      // observed (or a conflicting identity), and replaying it later would
      // fabricate a card.
      if (protocolEvent.toolCallId === undefined) {
        const pending = this.pendingTerminalsByTaskId.get(protocolEvent.taskId);
        this.pendingTerminalsByTaskId.set(protocolEvent.taskId, {
          status: pending?.status ?? protocolEvent.status,
          output: pending?.output ?? protocolEvent.output,
          progress:
            pending?.progress && protocolEvent.progress
              ? { ...pending.progress, ...protocolEvent.progress }
              : (pending?.progress ?? protocolEvent.progress),
        });
      }
      return NO_TASK_DECISION;
    }
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
    const launchAckToolCallId = protocolEvent.asyncLaunchTaskId
      ? this.launchAckOwner(protocolEvent.asyncLaunchTaskId, protocolEvent.results)
      : undefined;
    if (launchAckToolCallId) resultActions.set(launchAckToolCallId, { kind: "omit" });

    const ambiguousTaskId =
      protocolEvent.asyncLaunchTaskId &&
      !launchAckToolCallId &&
      !this.launchToolCallIdByTaskId.has(protocolEvent.asyncLaunchTaskId) &&
      protocolEvent.results.filter(
        ({ toolCallId }) => this.launchesByToolCallId.get(toolCallId)?.phase === "awaiting_identity"
      ).length > 1
        ? protocolEvent.asyncLaunchTaskId
        : undefined;

    // Async acknowledgements stay active; every unambiguous ordinary result is
    // terminal because the normal result pipeline already owns its final output.
    for (const { toolCallId, status } of protocolEvent.results) {
      const launch = this.launchesByToolCallId.get(toolCallId);
      if (launch && toolCallId !== launchAckToolCallId) {
        if (launch.phase === "awaiting_identity" && ambiguousTaskId) {
          this.launchesByToolCallId.set(toolCallId, {
            ...launch,
            candidateTaskId: ambiguousTaskId,
          });
        } else {
          if (launch.phase === "terminal") {
            resultActions.set(toolCallId, {
              kind: "preserve_status",
              status: launch.terminalStatus,
            });
          }
          this.markForegroundResult(launch, status);
        }
      }
    }

    return resultActions.size === 0
      ? NO_TASK_DECISION
      : { updates: EMPTY_TASK_UPDATES, resultActions };
  }

  private bindLaunch(toolCallId: string, taskId: string): IdentifiedTaskLaunch | undefined {
    const launch = this.launchesByToolCallId.get(toolCallId);
    if (!launch) return undefined;
    if (launch.phase === "active" && launch.taskId !== taskId) return undefined;
    if (launch.phase === "terminal" && launch.taskId && launch.taskId !== taskId) return undefined;
    const existing = this.launchToolCallIdByTaskId.get(taskId);
    if (existing && existing !== toolCallId) return undefined;
    if (launch.phase === "awaiting_identity" && launch.candidateTaskId !== undefined) {
      if (launch.candidateTaskId !== taskId) return undefined;
      this.pruneAmbiguousCandidates(taskId, toolCallId);
    }
    let identified: IdentifiedTaskLaunch;
    if (launch.phase === "awaiting_identity") {
      identified = { phase: "active", toolCallId, taskId };
    } else if (launch.phase === "terminal") {
      identified = { ...launch, taskId };
    } else {
      identified = launch;
    }
    this.launchesByToolCallId.set(toolCallId, identified);
    this.launchToolCallIdByTaskId.set(taskId, toolCallId);
    const pending = this.pendingTerminalsByTaskId.get(taskId);
    if (!pending) return identified;
    this.pendingTerminalsByTaskId.delete(taskId);
    const replay = this.mergeTerminal(identified, pending.status, pending.output, pending.progress);
    if (replay) this.replayedUpdates.push(replay);
    // mergeTerminal advanced the stored launch; return the settled record so
    // the caller's phase checks see the terminal state.
    return this.launchesByToolCallId.get(toolCallId) as IdentifiedTaskLaunch;
  }

  private resolveLaunch(
    toolCallId: string | undefined,
    taskId: string
  ): IdentifiedTaskLaunch | undefined {
    const resolvedToolCallId = toolCallId ?? this.launchToolCallIdByTaskId.get(taskId);
    return resolvedToolCallId ? this.bindLaunch(resolvedToolCallId, taskId) : undefined;
  }

  private launchAckOwner(
    taskId: string,
    results: readonly ClaudeToolResultBlock[]
  ): string | undefined {
    const known = this.launchToolCallIdByTaskId.get(taskId);
    if (known) {
      return results.some(({ toolCallId }) => toolCallId === known) ? known : undefined;
    }
    // Prompt and description describe work rather than identity. An explicit
    // task binding or one pending launch is required before ownership is safe.
    const candidates = results.filter(
      ({ toolCallId }) => this.launchesByToolCallId.get(toolCallId)?.phase === "awaiting_identity"
    );
    if (candidates.length !== 1) return undefined;
    return this.bindLaunch(candidates[0].toolCallId, taskId)?.toolCallId;
  }

  private pruneAmbiguousCandidates(taskId: string, ownerToolCallId: string): void {
    for (const [toolCallId, launch] of this.launchesByToolCallId) {
      if (
        toolCallId !== ownerToolCallId &&
        launch.phase === "awaiting_identity" &&
        launch.candidateTaskId === taskId
      ) {
        this.launchesByToolCallId.delete(toolCallId);
      }
    }
  }

  private markForegroundResult(launch: TaskLaunch, status: TerminalTaskStatus): void {
    if (launch.phase === "terminal") {
      if (!launch.outputAvailable) {
        this.launchesByToolCallId.set(launch.toolCallId, {
          ...launch,
          outputAvailable: true,
        });
      }
      return;
    }
    this.launchesByToolCallId.set(launch.toolCallId, {
      phase: "terminal",
      toolCallId: launch.toolCallId,
      ...(launch.phase === "active" ? { taskId: launch.taskId } : {}),
      terminalStatus: status,
      outputAvailable: true,
    });
  }

  private mergeTerminal(
    launch: IdentifiedTaskLaunch,
    status: TerminalTaskStatus,
    output?: string,
    progress?: AgentToolProgress
  ): ClaudeTaskToolUpdate | undefined {
    if (launch.phase === "terminal") {
      if (!output || launch.outputAvailable) return undefined;
      this.launchesByToolCallId.set(launch.toolCallId, {
        ...launch,
        outputAvailable: true,
      });
      return {
        toolCallId: launch.toolCallId,
        status: launch.terminalStatus,
        content: textContent(output),
        ...(progress ? { progress } : {}),
      };
    }

    this.launchesByToolCallId.set(launch.toolCallId, {
      phase: "terminal",
      toolCallId: launch.toolCallId,
      taskId: launch.taskId,
      terminalStatus: status,
      outputAvailable: output !== undefined,
    });
    return {
      toolCallId: launch.toolCallId,
      status,
      ...(output ? { content: textContent(output) } : {}),
      ...(progress ? { progress } : {}),
    };
  }
}

function protocolEventFromCarrier(carrier: ClaudeTaskCarrier): ClaudeTaskProtocolEvent | undefined {
  if (carrier.kind === "tool_snapshot") {
    if (carrier.nativeToolName === "Agent" || carrier.nativeToolName === "Task") {
      return {
        kind: "launch_observed",
        toolCallId: carrier.toolCallId,
      };
    }
    return undefined;
  }

  const message = carrier.message;
  if (message.type === "user") {
    return {
      kind: "result_batch",
      results: toolResultBlocks(message),
      asyncLaunchTaskId: readAsyncLaunchTaskId(message),
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
    patch?: unknown;
  };
  if (frame.subtype === "task_updated") {
    // `task_updated` carries a partial TaskState patch and no tool_use_id. A
    // subagent may report its terminal transition only here, so map terminal
    // patch statuses through the state machine; non-terminal patches carry
    // nothing the launch card renders.
    const taskId = nonEmptyString(frame.task_id);
    const patch = asRecord(frame.patch);
    const status = mapTerminalTaskStatus(patch?.status);
    if (!taskId || !status) return undefined;
    return {
      kind: "task_terminal",
      taskId,
      status,
      output: nonEmptyString(patch?.error),
    };
  }
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

function isTerminalLaunch(launch: IdentifiedTaskLaunch): launch is TerminalTaskLaunch & {
  taskId: string;
} {
  return launch.phase === "terminal";
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

function toolResultBlocks(msg: SDKMessage): ClaudeToolResultBlock[] {
  const content = asRecord((msg as { message?: unknown }).message)?.content;
  if (!Array.isArray(content)) return [];
  const results: ClaudeToolResultBlock[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record?.type !== "tool_result") continue;
    const toolCallId = nonEmptyString(record.tool_use_id);
    if (toolCallId) {
      results.push({
        toolCallId,
        status: record.is_error === true ? "failed" : "completed",
      });
    }
  }
  return results;
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

function readAsyncLaunchTaskId(msg: SDKMessage): string | undefined {
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
    case "killed":
      return "failed";
    default:
      return undefined;
  }
}
