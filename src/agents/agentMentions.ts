export type AgentMentionStatus =
  | "working"
  | "question"
  | "permission"
  | "finished"
  | "stopped"
  | "didnt_finish";

export interface AgentMention {
  id: string;
  agent: string;
  name: string;
  status: AgentMentionStatus;
  startedAt: number;
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
      RUNNING.has(mention.status) ? { ...mention, status: "didnt_finish" } : mention
    );
}

// A chat continued in a new chat asks each agent afresh, as its own agent starts afresh, instead of carrying on the hidden chat the earlier chat still uses.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
export function withoutAgentChats<T extends { agentMentions?: readonly AgentMention[] }>(
  message: T
): T {
  if (!message.agentMentions) return message;
  return {
    ...message,
    agentMentions: message.agentMentions.map((mention) => ({ ...mention, chat: undefined })),
  };
}
