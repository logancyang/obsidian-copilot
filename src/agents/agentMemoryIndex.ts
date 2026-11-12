import type { AgentDailyNoteInput } from "@/agents/agentMemory";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { parseDailyNoteConversations } from "@/agents/agentMemoryFile";
import { formatAgentDailyNoteLink } from "@/agents/agentPaths";

export const AGENT_MEMORY_INDEX_DAYS = 14;

export const AGENT_MEMORY_INDEX_MAX_LINES = 40;

const SUMMARY_SEPARATOR = "·";

export function agentMemoryIndexCutoff(now: Date, days: number = AGENT_MEMORY_INDEX_DAYS): string {
  const cutoff = new Date(now.getTime());
  cutoff.setDate(cutoff.getDate() - days);
  return formatMemoryEntryDate(cutoff);
}

interface IndexedConversation {
  date: string;
  time: string;
  title: string;
  summary: string | null;
}

export function buildAgentMemoryIndex(
  notes: readonly AgentDailyNoteInput[],
  maxLines: number = AGENT_MEMORY_INDEX_MAX_LINES
): string {
  const conversations: IndexedConversation[] = [];
  for (const note of notes) {
    for (const conversation of parseDailyNoteConversations(note.text)) {
      conversations.push({ date: note.date, ...conversation });
    }
  }
  conversations.reverse();
  conversations.sort((a, b) =>
    a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)
  );
  return conversations
    .slice(0, Math.max(0, maxLines))
    .map((conversation) => formatIndexLine(conversation))
    .join("\n");
}

function formatIndexLine(conversation: IndexedConversation): string {
  const summary = conversation.summary ? `${SUMMARY_SEPARATOR} ${conversation.summary}` : "";
  const parts = [
    `${conversation.date} ${conversation.time}`,
    conversation.title,
    summary,
    formatAgentDailyNoteLink(conversation.date),
  ];
  return `- ${parts.filter((part) => part.length > 0).join(" ")}`;
}
