export const AGENT_REPLY_MARKER = "copilot-agent-reply";
const NO_REPLY = "(no reply)";

// The design's relay principle, sent with every reply the current agent passes on.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export const RELAY_PRINCIPLE =
  "When you pass on another agent's reply, keep its position as strong as it was. If it disagrees with you or the user, say so plainly. Then add your own view if you have one.";

export interface AgentReplyMarker {
  agent: string;
  name: string;
  mention: string;
}

export interface AgentReplyRelay extends AgentReplyMarker {
  reply: string;
  denied: readonly string[];
  changed: readonly string[];
  error?: string;
}

export interface AgentReply {
  marker: AgentReplyMarker;
  reply: string;
}

const MARKER_LINE = new RegExp(`^<!-- ${AGENT_REPLY_MARKER} (\\{[^\\n]*\\}) -->\\n`);
const REPLY_OPEN = /\n<agent-reply from="[^\n]*">\n/;
const REPLY_CLOSE = "\n</agent-reply>";

export function formatAgentReply({
  agent,
  name,
  mention,
  reply,
  denied,
  changed,
  error,
}: AgentReplyRelay): string {
  const marker = JSON.stringify({ agent, name, mention }).replace(/>/g, "\\u003e");
  // The reply can quote a note or page written to close the quote early and pass its own text off as Copilot's.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  const quoted = reply.replace(/<\/agent-reply/gi, "&lt;/agent-reply");
  return [
    `<!-- ${AGENT_REPLY_MARKER} ${marker} -->`,
    error
      ? `${name} didn't finish (${error.trim()}). Tell the user how far ${name} got and why.`
      : `${name} replied. Pass the reply on to the user now.`,
    ...(denied.length > 0
      ? [
          `Copilot turned down the requests ${name} made, quoted below: this chat asks before changes, and ${name} can't get the user's approval from a chat ${name} was asked into. Tell the user what ${name} couldn't do.`,
          // A request's title is the asked agent's text, so it can carry a note's words passing as Copilot's; no tag inside it may close or open a block.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
          `<turned-down from="${name}">\n${denied.join("\n").replace(/</g, "&lt;")}\n</turned-down>`,
        ]
      : []),
    ...(changed.length > 0
      ? [`${name} changed ${changed.join(", ")}. The user sees these files under the reply.`]
      : []),
    RELAY_PRINCIPLE,
    `<agent-reply from="${name}">\n${quoted || NO_REPLY}\n</agent-reply>`,
  ].join("\n\n");
}

// The chat shows a relayed reply as the agent's words, so it reads them back from the marker and the quoted block, never from the instructions around them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
export function readAgentReply(text: string): AgentReply | null {
  const markerLine = MARKER_LINE.exec(text);
  const open = REPLY_OPEN.exec(text);
  const close = text.lastIndexOf(REPLY_CLOSE);
  if (!markerLine || !open || close < open.index) return null;
  let marker: Partial<AgentReplyMarker>;
  try {
    marker = JSON.parse(markerLine[1]) as Partial<AgentReplyMarker>;
  } catch {
    return null;
  }
  const { agent, name, mention } = marker;
  if (typeof agent !== "string" || typeof name !== "string" || typeof mention !== "string") {
    return null;
  }
  const reply = text.slice(open.index + open[0].length, close);
  if (reply === NO_REPLY) return { marker: { agent, name, mention }, reply: "" };
  // The chat shows the agent's words as it wrote them, so the closing tag escaped for the current agent is restored.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  return { marker: { agent, name, mention }, reply: reply.replace(/&lt;(\/agent-reply)/gi, "<$1") };
}
