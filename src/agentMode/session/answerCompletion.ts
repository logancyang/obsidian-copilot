import type { SessionEvent } from "@/agentMode/session/types";

export interface AnswerEnd {
  error: Error | undefined;
}

// An answer is final once its turn and its background tasks have ended, including the turn that reports a task finished after the answer's turn; a task's own content is not part of the answer. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
export class AnswerCompletion {
  private readonly runningTasks = new Set<string>();
  private turnOpen = false;
  private awaitingReport = false;
  private turnEnded = false;

  constructor(private readonly onText: (text: string) => void) {}

  handle(event: SessionEvent): AnswerEnd | null {
    const update = event.update;
    switch (update.sessionUpdate) {
      case "turn_started":
        if (this.turnEnded) this.onText("\n\n");
        this.turnOpen = true;
        this.awaitingReport = false;
        return null;
      case "turn_ended":
        this.turnOpen = false;
        this.turnEnded = true;
        if (update.error !== undefined) return { error: update.error };
        return this.runningTasks.size === 0 && !this.awaitingReport ? { error: undefined } : null;
      // An agent that exits starts no turn to report the tasks it ended. https://github.com/Brevilabs/obsidian-copilot-private/issues/175
      case "session_disconnected":
        return { error: update.error };
      case "task_started":
        if (update.taskId) this.runningTasks.add(update.taskId);
        return null;
      case "task_ended":
        if (this.runningTasks.delete(update.taskId) && !this.turnOpen) this.awaitingReport = true;
        return null;
      case "agent_message_chunk":
        if (!event.taskToolCallId && update.content.type === "text") {
          this.onText(update.content.text);
        }
        return null;
      default:
        return null;
    }
  }
}
