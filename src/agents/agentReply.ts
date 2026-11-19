export const AGENT_REPLY_MARKER = "copilot-agent-reply";

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
  error?: string;
}

export function formatAgentReply({
  agent,
  name,
  mention,
  reply,
  denied,
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
    RELAY_PRINCIPLE,
    `<agent-reply from="${name}">\n${quoted || "(no reply)"}\n</agent-reply>`,
  ].join("\n\n");
}
