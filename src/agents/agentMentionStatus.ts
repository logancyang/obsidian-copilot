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

function didntFinish(mention: AgentMention): Pick<MentionStatusLine, "text" | "details"> {
  const { name, end } = mention;
  switch (end?.kind) {
    case "error":
      return { text: `${name} didn't finish · Something went wrong`, details: end.message };
    case "permission_denied":
      return {
        text: `${name} didn't finish · Copilot turned down ${
          end.requests.length === 1 ? "a request" : `${end.requests.length} requests`
        }`,
        details: end.requests.join("\n"),
      };
    default:
      return { text: `${name} didn't finish · Obsidian was closed` };
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
    case "didnt_finish":
      return { ...didntFinish(mention), tone: "failed", seeReply: false };
  }
}
