export type AgentMentionStatus =
  | "working"
  | "question"
  | "permission"
  | "finished"
  | "stopped"
  | "didnt_finish";

export type AgentMentionEnd =
  | { kind: "obsidian_closed" }
  | { kind: "error"; message: string }
  | { kind: "permission_denied"; requests: readonly string[] }
  | { kind: "stopped_by_user" }
  | { kind: "agent_deleted" };

export interface AgentMention {
  id: string;
  agent: string;
  name: string;
  status: AgentMentionStatus;
  startedAt: number;
  endedAt?: number;
  end?: AgentMentionEnd;
  chat?: { backendId: string; sessionId: string };
}

type Saved = Partial<Record<string, unknown>> | null | undefined;

const STATUSES: ReadonlySet<string> = new Set<AgentMentionStatus>([
  "working",
  "question",
  "permission",
  "finished",
  "stopped",
  "didnt_finish",
]);
const RUNNING: ReadonlySet<AgentMentionStatus> = new Set(["working", "question", "permission"]);

function isEnd(saved: unknown): saved is AgentMentionEnd {
  const end = saved as Saved;
  switch (end?.kind) {
    case "obsidian_closed":
    case "stopped_by_user":
    case "agent_deleted":
      return true;
    case "error":
      return typeof end.message === "string";
    case "permission_denied":
      return Array.isArray(end.requests) && end.requests.every((r) => typeof r === "string");
    default:
      return false;
  }
}

// A chat note is user-editable, so a run with any field of the wrong shape is dropped instead of reaching the views that draw it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
function isAgentMention(saved: unknown): saved is AgentMention {
  const mention = saved as Saved;
  const chat = mention?.chat as Saved;
  return (
    typeof mention?.id === "string" &&
    typeof mention.agent === "string" &&
    typeof mention.name === "string" &&
    typeof mention.status === "string" &&
    STATUSES.has(mention.status) &&
    typeof mention.startedAt === "number" &&
    (mention.endedAt === undefined || typeof mention.endedAt === "number") &&
    (mention.end === undefined || isEnd(mention.end)) &&
    (mention.chat === undefined ||
      (typeof chat?.backendId === "string" && typeof chat.sessionId === "string"))
  );
}

// Each @ saves its agent's run on the message that asked; an agent still running when its chat was saved stopped when Obsidian closed, so a chat opened again shows it didn't finish.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export function restoreAgentMentions(saved: unknown): AgentMention[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(isAgentMention)
    .map((mention) =>
      RUNNING.has(mention.status)
        ? { ...mention, status: "didnt_finish", end: { kind: "obsidian_closed" } }
        : mention
    );
}
