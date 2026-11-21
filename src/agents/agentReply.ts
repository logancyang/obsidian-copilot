import type { AgentMention } from "@/agents/agentMentions";

export const AGENT_REPLY_MARKER = "copilot-teammate-reply";
const NO_REPLY = "(no reply)";

// The design's relay principle, sent with every reply the current agent passes on.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export const RELAY_PRINCIPLE =
  "When you pass on another AI teammate's reply, keep its position as strong as it was. If it disagrees with you or the user, say so plainly. Then add your own view if you have one.";

const STOPPED_HOW: Record<NonNullable<AgentReplyRelay["stopped"]>, (name: string) => string> = {
  stopped_by_user: () => ", as the user asked",
  // A stop from the running agents list never went through the chat's agent, which otherwise tells the user it didn't stop anyone, and given who stopped it, repeats that back to the user who pressed stop.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/948
  stopped_from_list: (name) =>
    `. The user already knows, so don't mention the stop; go straight to how far ${name} got`,
  agent_deleted: (name) => ` because the user deleted ${name}`,
};

export interface AgentReplyMarker {
  agent: string;
  name: string;
  mention: string;
  status?: unknown;
  chat?: unknown;
}

export interface AgentReplyRelay extends AgentReplyMarker {
  status?: AgentMention["status"];
  chat?: AgentMention["chat"];
  reply: string;
  changed: readonly string[];
  error?: string;
  stopped?: "stopped_by_user" | "stopped_from_list" | "agent_deleted";
  declined?: boolean;
  question?: boolean;
  stillWorking?: readonly string[];
}

export interface AgentReply {
  marker: AgentReplyMarker;
  reply: string;
}

export function joinNames(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const MARKER_LINE = new RegExp(`^<!-- ${AGENT_REPLY_MARKER} (\\{[^\\n]*\\}) -->\\n`);
const REPLY_OPEN = /\n<teammate-reply from="[^\n]*">\n/;
const REPLY_CLOSE = "\n</teammate-reply>";

export function formatAgentReply({
  agent,
  name,
  mention,
  status,
  chat,
  reply,
  changed,
  error,
  stopped,
  declined,
  question,
  stillWorking = [],
}: AgentReplyRelay): string {
  // A chat without a note keeps its runs only in its agent's history, so each relay carries how its run ended and the asked agent's chat for a reopened chat to rebuild the run from.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/976
  const marker = JSON.stringify({ teammate: agent, name, mention, status, chat }).replace(
    />/g,
    "\\u003e"
  );
  // The reply can quote a note or page written to close the quote early and pass its own text off as Copilot's.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  const quoted = reply.replace(/<\/teammate-reply/gi, "&lt;/teammate-reply");
  return [
    `<!-- ${AGENT_REPLY_MARKER} ${marker} -->`,
    question
      ? `${name} has a question for the user, quoted below, and waits for the answer. Ask the user in your own words, then end your turn. When the user answers, pass the answer to ${name} with answer_teammate.`
      : stopped
        ? `${name} stopped${STOPPED_HOW[stopped](name)}. ${name}'s changes stay. Tell the user how far ${name} got and what ${name} changed; when ${name}'s reply doesn't say, read the files ${name} changed to find out.`
        : error
          ? `${name} didn't finish (${error.trim()}). Tell the user how far ${name} got and why.`
          : `${name} replied. Pass the reply on to the user now.`,
    // One message can ask several agents, and the user should hear who is still at it when the first reply comes back.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/949
    ...(stillWorking.length > 0
      ? [
          `${joinNames(stillWorking)} ${stillWorking.length > 1 ? "are" : "is"} still working on what you asked. Tell the user so, and that you'll pass ${stillWorking.length > 1 ? "each" : "the"} reply on when it comes back.`,
        ]
      : []),
    ...(declined
      ? [`The user turned down a request from ${name} on a permission card in this chat.`]
      : []),
    ...(changed.length > 0
      ? [`${name} changed ${changed.join(", ")}. The user sees these files under the reply.`]
      : []),
    RELAY_PRINCIPLE,
    `<teammate-reply from="${name}">\n${quoted || NO_REPLY}\n</teammate-reply>`,
  ].join("\n\n");
}

// The chat shows a relayed reply as the agent's words, so it reads them back from the marker and the quoted block, never from the instructions around them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export function readAgentReply(text: string): AgentReply | null {
  const markerLine = MARKER_LINE.exec(text);
  const open = REPLY_OPEN.exec(text);
  const close = text.lastIndexOf(REPLY_CLOSE);
  if (!markerLine || !open || close < open.index) return null;
  let marker: Partial<Omit<AgentReplyMarker, "agent"> & { teammate: string }>;
  try {
    marker = JSON.parse(markerLine[1]) as typeof marker;
  } catch {
    return null;
  }
  const { teammate: agent, name, mention, status, chat } = marker;
  if (typeof agent !== "string" || typeof name !== "string" || typeof mention !== "string") {
    return null;
  }
  const read = { agent, name, mention, status, chat };
  const reply = text.slice(open.index + open[0].length, close);
  if (reply === NO_REPLY) return { marker: read, reply: "" };
  // The chat shows the agent's words as it wrote them, so the closing tag escaped for the current agent is restored.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  return { marker: read, reply: reply.replace(/&lt;(\/teammate-reply)/gi, "<$1") };
}
