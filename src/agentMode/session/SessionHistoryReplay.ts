import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  findToolCallPart,
  mergeToolCallUpdate,
  planToPart,
  toolCallToPart,
  upsertCompactionPart,
} from "@/agentMode/session/messageParts";
import {
  extractText,
  OUTPUT_LIMIT_CONTINUATION_PROMPT,
  stripUserMessageWrapper,
} from "@/agentMode/session/promptEnvelope";
import type { AgentPlanEntry, CompactionSnapshot, SessionEvent } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { formatDateTime, type FormattedDateTime } from "@/utils";

export interface SessionHistoryReplayDeps {
  store: AgentMessageStore;
  scheduleNotifyMessages(): void;
  applyTodoList(entries: AgentPlanEntry[]): void;
}

export class SessionHistoryReplay {
  private open = false;
  private user: { wireId: string | undefined; raw: string; occurredAt?: number } | null = null;
  private aiId: string | null = null;
  private turnStartedAt: number | undefined;

  constructor(private readonly deps: SessionHistoryReplayDeps) {}

  start(): void {
    this.open = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  append(update: SessionEvent["update"], occurredAt: number | undefined): boolean {
    if (!this.open || !this.appendFrame(update, occurredAt)) return false;
    this.extendTurn(occurredAt);
    return true;
  }

  // Frames replayed before the load response are the chat's past turns, not a turn in flight. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private appendFrame(update: SessionEvent["update"], occurredAt: number | undefined): boolean {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = extractText(update.content);
        const current = this.user;
        if (current && update.messageId !== undefined && current.wireId === update.messageId) {
          current.raw += text;
          return true;
        }
        if (!text.trim()) return true;
        this.flushUser();
        this.closeTurn();
        this.user = { wireId: update.messageId, raw: text, occurredAt };
        this.turnStartedAt = occurredAt;
        return true;
      }
      // A replayed turn's end closes its reply, so a reply the agent started on its own gets its own bubble. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
      case "turn_ended":
        this.flushUser();
        this.closeTurn();
        this.turnStartedAt = occurredAt;
        return true;
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return true;
        const id = this.aiBubbleId(occurredAt);
        const appended =
          update.sessionUpdate === "agent_message_chunk"
            ? this.deps.store.appendAgentText(id, text)
            : this.deps.store.appendAgentThought(id, text);
        if (appended) this.deps.scheduleNotifyMessages();
        return true;
      }
      case "tool_call":
        if (this.deps.store.upsertAgentPart(this.aiBubbleId(occurredAt), toolCallToPart(update))) {
          this.deps.scheduleNotifyMessages();
        }
        return true;
      case "tool_call_update": {
        const id =
          this.deps.store.findMessageIdWithToolCall(update.toolCallId) ??
          this.aiBubbleId(occurredAt);
        const merged = mergeToolCallUpdate(
          findToolCallPart(this.deps.store, id, update.toolCallId),
          update
        );
        if (this.deps.store.upsertAgentPart(id, merged)) this.deps.scheduleNotifyMessages();
        return true;
      }
      case "plan":
        if (this.deps.store.upsertAgentPart(this.aiBubbleId(occurredAt), planToPart(update))) {
          this.deps.scheduleNotifyMessages();
        }
        // The last replayed task list is the one the chat closed with, so the project popover shows it again. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
        this.deps.applyTodoList(update.entries);
        return true;
      case "compaction": {
        // A replayed compaction is already over, so one that never reports an end settles as cancelled rather than spinning. https://github.com/Brevilabs/obsidian-copilot-private/issues/638
        const settled: CompactionSnapshot =
          update.status === "in_progress" ? { ...update, status: "cancelled" } : update;
        if (upsertCompactionPart(this.deps.store, this.aiBubbleId(occurredAt), settled)) {
          this.deps.scheduleNotifyMessages();
        }
        return true;
      }
      default:
        return false;
    }
  }

  // A prompt's context envelope stays hidden until its wrapper is complete, so a user bubble waits for the message to end. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private flushUser(): void {
    const pending = this.user;
    this.user = null;
    if (!pending) return;
    // The plugin's own continuation is not something the user typed. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
    if (stripUserMessageWrapper(pending.raw).trim() === OUTPUT_LIMIT_CONTINUATION_PROMPT) return;
    this.deps.store.addMessage({
      message: stripUserMessageWrapper(pending.raw),
      sender: USER_SENDER,
      timestamp: historyTimestamp(pending.occurredAt),
      isVisible: true,
    });
    this.deps.scheduleNotifyMessages();
  }

  private aiBubbleId(occurredAt: number | undefined): string {
    if (this.aiId) return this.aiId;
    this.flushUser();
    const startedAt = this.turnStartedAt;
    this.aiId = this.deps.store.addMessage({
      message: "",
      sender: AI_SENDER,
      timestamp: historyTimestamp(occurredAt),
      isVisible: true,
      parts: [],
      turnDurationMs:
        startedAt === undefined || occurredAt === undefined
          ? undefined
          : Math.max(0, occurredAt - startedAt),
    });
    return this.aiId;
  }

  // A replayed turn lasts from its prompt to its last timed frame; frames from an agent that sends no times leave it untimed. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
  private extendTurn(occurredAt: number | undefined): void {
    const startedAt = this.turnStartedAt;
    if (!this.aiId || startedAt === undefined || occurredAt === undefined) return;
    if (this.deps.store.extendTurnDuration(this.aiId, occurredAt - startedAt)) {
      this.deps.scheduleNotifyMessages();
    }
  }

  end(): void {
    this.flushUser();
    this.open = false;
    this.closeTurn();
    this.turnStartedAt = undefined;
  }

  // A replayed turn is over, so a step it never finished did not run. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
  private closeTurn(): void {
    if (this.aiId && this.deps.store.settleOpenParts(this.aiId)) {
      this.deps.scheduleNotifyMessages();
    }
    this.aiId = null;
  }
}

function historyTimestamp(occurredAt: number | undefined): FormattedDateTime | null {
  return occurredAt === undefined ? null : formatDateTime(new Date(occurredAt));
}
