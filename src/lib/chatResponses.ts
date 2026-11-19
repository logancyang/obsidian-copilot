export type ChatMessageRole = "typed" | "reply" | "other";

export interface MessageGroup {
  messages: number[];
  replies: number[];
}

// A response is everything the agent says between two messages the user typed, so its buttons show once, at its last reply.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/971
export function groupResponses(roles: readonly ChatMessageRole[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let response: MessageGroup | null = null;
  roles.forEach((role, index) => {
    if (role === "typed") {
      groups.push({ messages: [index], replies: [] });
      response = null;
      return;
    }
    if (!response) {
      response = { messages: [], replies: [] };
      groups.push(response);
    }
    response.messages.push(index);
    if (role === "reply") response.replies.push(index);
  });
  return groups;
}

export function joinResponseText(replyTexts: readonly string[]): string {
  return replyTexts.filter((text) => text.trim().length > 0).join("\n\n");
}
