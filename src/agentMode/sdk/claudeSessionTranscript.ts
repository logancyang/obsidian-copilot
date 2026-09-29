import { AI_SENDER, USER_SENDER } from "@/constants";
import { formatDateTime } from "@/utils";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import type { AgentChatMessage } from "@/agentMode/session/types";

export function parseClaudeTranscript(jsonlText: string): AgentChatMessage[] {
  const messages: AgentChatMessage[] = [];
  const lines = jsonlText.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: ClaudeTranscriptEntry;
    try {
      entry = JSON.parse(line) as ClaudeTranscriptEntry;
    } catch {
      continue;
    }
    if (entry.isMeta === true || entry.isSidechain === true) continue;
    const content = entry.message?.content;

    let sender: string | null = null;
    let text = "";
    if (entry.type === "user" && typeof content === "string") {
      sender = USER_SENDER;
      text = stripUserMessageWrapper(content).trim();
    } else if (entry.type === "user" && Array.isArray(content)) {
      if (!content.some((b) => b?.type === "tool_result")) {
        sender = USER_SENDER;
        text = stripUserMessageWrapper(joinTextBlocks(content)).trim();
      }
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      sender = AI_SENDER;
      text = joinTextBlocks(content);
    }
    if (!sender || !text) continue;

    messages.push({
      id: `claude-loaded-${messages.length}`,
      sender,
      message: text,
      isVisible: true,
      timestamp: toTimestamp(entry.timestamp),
    });
  }
  return messages;
}

interface ClaudeTranscriptEntry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: unknown;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

interface ContentBlock {
  type?: string;
  text?: string;
}

function joinTextBlocks(content: ContentBlock[]): string {
  return content
    .filter(
      (b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string"
    )
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function toTimestamp(raw: unknown): AgentChatMessage["timestamp"] {
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateTime(date);
}
