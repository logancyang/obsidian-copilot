import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import type { SessionEvent, SessionId, SessionUpdate, TurnEnd } from "@/agentMode/session/types";
import { AsyncPushQueue } from "./asyncPushQueue";
import { cancelQueuedMessage } from "./claudeQueryControls";
import { describeSdkMessage, logSdkError, logSdkInbound } from "./sdkDebugTap";
import { mapStopReason, translateSdkMessage, type TranslatorState } from "./sdkMessageTranslator";
import {
  SDK_STREAM_STALL_MESSAGE,
  SDK_STREAM_STALL_TIMEOUT_MS,
  SdkStreamStallGuard,
} from "./sdkStreamStallGuard";

export const CLAUDE_DISCONNECTED_MESSAGE =
  "Claude Code stopped unexpectedly. Send your message again to reconnect.";

export type ClaudeUserContent = SDKUserMessage["message"]["content"];

export interface ClaudeLiveQueryOptions {
  sessionId: SessionId;
  start: (input: AsyncIterable<SDKUserMessage>) => Query;
  translator: TranslatorState;
  emit: (event: SessionEvent) => void;
  onTurnStarted: (query: Query) => void;
  onSignedOut: () => void;
  onEnded: () => void;
  stallTimeoutMs?: number;
}

export class ClaudeLiveQuery {
  readonly query: Query;
  private readonly input = new AsyncPushQueue<SDKUserMessage>();
  private readonly undelivered: string[] = [];
  private readonly stallGuard: SdkStreamStallGuard;
  private readonly stallTimeoutMs: number;
  private openTurnId: string | null = null;
  private turnBeganAt: number | null = null;
  private closed = false;
  private interrupted = false;
  private stopWithdrawals: string[] | null = null;
  private stallError: Error | null = null;
  private resultWatch: number | undefined;

  constructor(private readonly opts: ClaudeLiveQueryOptions) {
    this.stallTimeoutMs = opts.stallTimeoutMs ?? SDK_STREAM_STALL_TIMEOUT_MS;
    this.stallGuard = new SdkStreamStallGuard(() => this.handleStall(), this.stallTimeoutMs);
    this.query = opts.start(this.input);
    void this.consume();
  }

  push(promptId: string, content: ClaudeUserContent, interrupt = false): void {
    this.undelivered.push(promptId);
    this.input.push({
      type: "user",
      uuid: promptId as SDKUserMessage["uuid"],
      session_id: "",
      parent_tool_use_id: null,
      message: { role: "user", content },
      // "now" ends the running turn at its next safe point and runs this message; background tasks keep running. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
      ...(interrupt ? { priority: "now" as const } : {}),
    });
  }

  // Stop takes back each message Claude has not read, then interrupts without cancel_queued, which would also drop a finished background task's report waiting in Claude's queue. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
  async interrupt(): Promise<void> {
    this.interrupted = true;
    const withdrawn: string[] = [];
    this.stopWithdrawals = withdrawn;
    await Promise.all(
      this.undelivered.map(async (id) => {
        const cancelled = await cancelQueuedMessage(this.query, id).catch((e: unknown) => {
          logWarn("[AgentMode] withdraw at Stop", e);
          return false;
        });
        if (cancelled) withdrawn.push(id);
      })
    );
    this.stopWithdrawals = null;
    // One report for the whole Stop returns its messages to the composer together, in send order. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    this.withdraw(withdrawn);
    await this.query.interrupt();
  }

  async cancelQueued(promptId: string): Promise<boolean> {
    const cancelled = await cancelQueuedMessage(this.query, promptId);
    if (cancelled) this.withdraw([promptId]);
    return cancelled;
  }

  close(): void {
    this.closed = true;
    this.clearResultWatch();
    this.stallGuard.disarm();
    this.input.end();
    this.query.close();
  }

  private async consume(): Promise<void> {
    let failure: unknown = null;
    try {
      for await (const msg of this.query) {
        if (this.closed) break;
        logSdkInbound(describeSdkMessage(msg), msg, this.opts.sessionId);
        this.handle(msg);
      }
    } catch (e) {
      failure = e;
    }
    this.clearResultWatch();
    this.stallGuard.disarm();
    if (!this.closed) this.disconnect(failure);
    this.opts.onEnded();
  }

  private handle(msg: SDKMessage): void {
    if (isReplayEcho(msg)) {
      this.deliver(msg.uuid);
      return;
    }
    // Claude drops a message it never ran, such as one withdrawn before Claude was ready, with only this frame. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
    const cancelled = cancelledCommandUuid(msg);
    if (cancelled !== null) {
      if (this.stopWithdrawals) this.stopWithdrawals.push(cancelled);
      else this.withdraw([cancelled]);
      return;
    }
    // Claude announces each turn with an init frame, well before a reply it starts on its own streams, so that reply's duration counts from here. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (msg.type === "system" && msg.subtype === "init" && !this.openTurnId) {
      this.turnBeganAt = Date.now();
    }
    const taskToolCallId =
      "parent_tool_use_id" in msg ? (msg.parent_tool_use_id ?? undefined) : undefined;
    if (!taskToolCallId && isTurnContent(msg)) this.startTurn();
    // A background task's frames say nothing about the main reply's stream, so they must not keep a stalled turn alive. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    if (!taskToolCallId && this.openTurnId && !("task_id" in msg)) this.stallGuard.observe(msg);
    // A subagent's frames carry the tool call that launched it; they belong to its task, not to a main-agent reply. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    for (const event of translateSdkMessage(msg, this.opts.sessionId, this.opts.translator)) {
      this.opts.emit(taskToolCallId ? { ...event, taskToolCallId } : event);
    }
    if (msg.type === "result") this.finishTurn(msg);
  }

  // Claude echoes each prompt as it joins the conversation; the echo opens that prompt's turn,
  // and echoes of input Copilot did not send (folded task notifications) are not deliveries.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  private deliver(uuid: string | undefined): void {
    const index = uuid === undefined ? -1 : this.undelivered.indexOf(uuid);
    if (index < 0) return;
    this.undelivered.splice(index, 1);
    this.emit({ sessionUpdate: "message_delivered", promptId: uuid! });
    this.startTurn();
  }

  private startTurn(): void {
    if (this.openTurnId) return;
    this.openTurnId = uuidv4();
    const startedAt = this.turnBeganAt ?? undefined;
    this.turnBeganAt = null;
    this.emit({ sessionUpdate: "turn_started", turnId: this.openTurnId, startedAt });
    this.opts.onTurnStarted(this.query);
  }

  private finishTurn(msg: SDKResultMessage): void {
    this.clearResultWatch();
    const interrupted = this.interrupted;
    this.interrupted = false;
    this.opts.translator.compactionTrigger = "auto";
    // A prompt stopped before Claude checked it is never echoed; only its result names it. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
    const consumed = (msg as { user_message_uuids?: unknown }).user_message_uuids;
    if (Array.isArray(consumed)) {
      for (const uuid of consumed) if (typeof uuid === "string") this.deliver(uuid);
    }
    if (!this.openTurnId) return;
    const stopReason = mapStopReason(msg);
    let error: Error | undefined;
    if (msg.subtype === "success" && msg.is_error && msg.result.trim()) {
      error = new Error(msg.result);
    } else if (stopReason !== "end_turn" && msg.subtype !== "success") {
      const errors = "errors" in msg ? msg.errors : undefined;
      if (errors && errors.length > 0) error = new Error(errors.join("; "));
      // A turn Stop ended can fail without naming an error. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
      else if (!interrupted) this.opts.onSignedOut();
    }
    this.endTurn({ stopReason, ...(error ? { error } : {}) });
  }

  private endTurn(end: Omit<TurnEnd, "turnId">): void {
    const turnId = this.openTurnId;
    if (!turnId) return;
    this.openTurnId = null;
    this.stallGuard.disarm();
    this.emit({ sessionUpdate: "turn_ended", turnId, ...end });
  }

  // A stalled turn ends at once; the query is closed only when Claude does not answer the
  // interrupt either. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  private handleStall(): void {
    logSdkError("←", "stream:stalled", { idleMs: this.stallTimeoutMs }, this.opts.sessionId);
    this.endTurn({ stopReason: "end_turn", error: new Error(SDK_STREAM_STALL_MESSAGE) });
    this.query.interrupt().catch((e: unknown) => logWarn("[AgentMode] stalled turn interrupt", e));
    this.resultWatch = window.setTimeout(() => {
      this.resultWatch = undefined;
      this.stallError = new Error(SDK_STREAM_STALL_MESSAGE);
      this.query.close();
    }, this.stallTimeoutMs);
  }

  private disconnect(failure: unknown): void {
    const error =
      failure instanceof Error
        ? failure
        : (this.stallError ??
          new Error(failure === null ? CLAUDE_DISCONNECTED_MESSAGE : err2String(failure)));
    logSdkError("←", "query:ended", { error: err2String(error) }, this.opts.sessionId);
    this.endTurn({ stopReason: "end_turn", error });
    this.withdraw([...this.undelivered]);
    for (const update of this.opts.translator.tasks.stopRunning()) this.emit(update);
    this.emit({ sessionUpdate: "session_disconnected", error });
  }

  private withdraw(promptIds: readonly string[]): void {
    const withdrawn = promptIds.filter((id) => {
      const index = this.undelivered.indexOf(id);
      if (index >= 0) this.undelivered.splice(index, 1);
      return index >= 0;
    });
    if (withdrawn.length > 0) {
      this.emit({ sessionUpdate: "messages_withdrawn", promptIds: withdrawn });
    }
  }

  private clearResultWatch(): void {
    if (this.resultWatch === undefined) return;
    window.clearTimeout(this.resultWatch);
    this.resultWatch = undefined;
  }

  private emit(update: SessionUpdate): void {
    this.opts.emit({ sessionId: this.opts.sessionId, update });
  }
}

function isReplayEcho(msg: SDKMessage): msg is SDKMessage & { type: "user"; uuid?: string } {
  return msg.type === "user" && (msg as { isReplay?: unknown }).isReplay === true;
}

function cancelledCommandUuid(msg: SDKMessage): string | null {
  const frame = msg as { type: string; state?: unknown; command_uuid?: unknown };
  if (frame.type !== "command_lifecycle" || frame.state !== "cancelled") return null;
  return typeof frame.command_uuid === "string" ? frame.command_uuid : null;
}

function isTurnContent(msg: SDKMessage): boolean {
  if (msg.type === "assistant" || msg.type === "stream_event") return true;
  if (msg.type !== "user") return false;
  const content = (msg.message as { content?: unknown }).content;
  return (
    Array.isArray(content) &&
    content.some((block) => (block as { type?: unknown })?.type === "tool_result")
  );
}
