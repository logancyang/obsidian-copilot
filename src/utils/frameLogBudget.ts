import { byteLength, headOfText, tailOfText } from "@/utils/logTail";

export function fitConversationFrames(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  // A whole-log tail loses older chats and their model; budget each chat's state and head/tail independently.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/658
  const conversations = text.split(/(?=^\{"frameSink":"conversation",)/m).filter(Boolean);
  const share = Math.floor(maxBytes / conversations.length);
  return conversations.map((conversation) => fitConversation(conversation, share)).join("");
}

function fitConversation(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const state: string[] = [];
  const frames: string[] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    if (
      line.includes('"method":"frameSink.state"') ||
      line.startsWith('{"frameSink":"conversation",')
    ) {
      state.push(line);
    } else {
      frames.push(line);
    }
  }
  const prefix = state.length ? state.join("\n") + "\n" : "";
  const marker = JSON.stringify({ frameSink: "elided" }) + "\n";
  const room = maxBytes - byteLength(prefix + marker);
  // A screenshot can leave too little room even for state; fail explicitly instead of silently losing a chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/658
  if (room <= 0) throw new Error("Conversation state exceeds the frame-log budget");
  const body = frames.join("\n") + "\n";
  const headBytes = Math.floor(room / 3);
  const head = headOfText(body, headBytes).text;
  const tail = tailOfText(body, room - headBytes).text.replace(/^[^\n]*\n?/, "");
  return prefix + head.slice(0, head.lastIndexOf("\n") + 1) + marker + tail;
}
