import type { AgentMention } from "@/agents/agentMentions";

export type MentionStatusTone = "working" | "waiting" | "finished" | "stopped" | "failed";

export interface MentionStatusLine {
  text: string;
  tone: MentionStatusTone;
  clock?: "ticking" | "held";
  elapsedMs?: number;
  details?: string;
  seeReply: boolean;
}

export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export interface DidntFinishReason {
  reason: string;
  details?: string;
}

export function didntFinishReason({ end }: AgentMention): DidntFinishReason {
  switch (end?.kind) {
    case "error":
      return { reason: "Something went wrong", details: end.message };
    case "permission_denied":
      return {
        reason: `Copilot turned down ${
          end.requests.length === 1 ? "a request" : `${end.requests.length} requests`
        }`,
        details: end.requests.join("\n"),
      };
    default:
      return { reason: "Obsidian was closed" };
  }
}

// The design's 3.13 table: what the line under an @ message says for each state of the asked agent's run. The clock holds while the agent waits on the user and counts on once it works again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function mentionStatusLine(mention: AgentMention): MentionStatusLine {
  const { name, status, startedAt, endedAt } = mention;
  const elapsed = endedAt === undefined ? {} : { elapsedMs: endedAt - startedAt };
  switch (status) {
    case "working":
      return { text: `${name} is working`, tone: "working", clock: "ticking", seeReply: false };
    case "question":
      return { text: `${name} has a question`, tone: "waiting", clock: "held", seeReply: false };
    case "permission":
      return { text: `${name} needs your OK`, tone: "waiting", clock: "held", seeReply: false };
    case "finished":
      return { text: `${name} finished`, tone: "finished", ...elapsed, seeReply: true };
    case "stopped":
      return {
        text:
          mention.end?.kind === "agent_deleted"
            ? `${name} stopped · ${name} was deleted`
            : `${name} stopped`,
        tone: "stopped",
        ...elapsed,
        seeReply: false,
      };
    case "didnt_finish": {
      const { reason, details } = didntFinishReason(mention);
      return {
        text: `${name} didn't finish · ${reason}`,
        ...(details === undefined ? {} : { details }),
        tone: "failed",
        seeReply: false,
      };
    }
  }
}

export interface RunningAgentsLine {
  text: string;
  waiting: boolean;
  clockFrom?: number;
}

function agentsDoing(names: readonly string[], verb: string): string {
  if (names.length >= 4) return `${names.length} agents are ${verb}`;
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${listed} ${names.length === 1 ? "is" : "are"} ${verb}`;
}

// The design's wording for the line above the composer: agents waiting on the user come first and turn it orange, one working agent alone carries a clock, and the chat's own tasks are only counted.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function runningAgentsLine(
  runs: readonly AgentMention[],
  taskCount: number
): RunningAgentsLine {
  const waiting = runs.filter((run) => run.status !== "working");
  const working = runs.filter((run) => run.status === "working");
  const parts = [
    waiting.length === 1 && waiting[0].status === "permission"
      ? `${waiting[0].name} needs your OK`
      : waiting.length > 0
        ? agentsDoing(
            waiting.map((run) => run.name),
            "waiting for you"
          )
        : null,
    working.length > 0
      ? agentsDoing(
          working.map((run) => run.name),
          "working"
        )
      : null,
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : null,
  ];
  const alone = runs.length === 1 && working.length === 1 && taskCount === 0;
  return {
    text: parts.filter((part) => part !== null).join(" · "),
    waiting: waiting.length > 0,
    ...(alone ? { clockFrom: working[0].startedAt } : {}),
  };
}
