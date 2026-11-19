import type { AgentSession } from "@/agentMode/session/AgentSession";

export type TabDot = "waiting" | "done" | "error";

export type TabDotChat = Pick<AgentSession, "getStatus" | "getNeedsAttention" | "store">;

const DOT_URGENCY: readonly TabDot[] = ["error", "done", "waiting"];

function askedAgentWaits(chat: TabDotChat, on: readonly string[]): boolean {
  return chat.store
    .getDisplayMessages()
    .some((message) => message.agentMentions?.some((run) => on.includes(run.status)));
}

// A chat's dot says why it wants the user: orange while it or an agent it asked waits on the user, green once it is done while the user was elsewhere.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function tabDot(chat: TabDotChat, active = false): TabDot | null {
  const status = chat.getStatus();
  if (status === "running") return null;
  // An asked agent's permission card arrives while the chat that asked is idle, so no turn of that chat ends to call the user back.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/948
  if (!active && askedAgentWaits(chat, ["permission"])) return "waiting";
  if (!chat.getNeedsAttention()) return status === "error" ? "error" : null;
  return status === "awaiting_permission" || askedAgentWaits(chat, ["question", "permission"])
    ? "waiting"
    : "done";
}

// A dotted chat moved into the "…" menu would go unseen, so the menu's button carries the most urgent of their dots.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/948
export function overflowDot(dots: readonly (TabDot | null)[]): TabDot | null {
  return dots.reduce<TabDot | null>(
    (urgent, dot) =>
      dot && (!urgent || DOT_URGENCY.indexOf(dot) > DOT_URGENCY.indexOf(urgent)) ? dot : urgent,
    null
  );
}
