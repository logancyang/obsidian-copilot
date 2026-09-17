import type { AgentDailyNoteInput } from "@/agents/agentMemory";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { parseDailyNoteConversations } from "@/agents/agentMemoryFile";
import { formatAgentDailyNoteLink } from "@/agents/agentPaths";

/**
 * How many days of daily notes the conversation index covers, counting today.
 *
 * Two weeks is the span over which "what did we decide about this" is still
 * asked without saying when; anything older is reached through the summary or
 * by the agent opening a note itself. See `designdocs/CUSTOM_AGENTS.md` §5
 * ("Reading").
 */
export const AGENT_MEMORY_INDEX_DAYS = 14;

/**
 * How many conversations the index lists at most.
 *
 * The index rides every turn whose memory changed, so it is capped the way the
 * curated core is. A user who held more than forty conversations inside the
 * window keeps the most recent ones, which is where an unspoken "we" points.
 */
export const AGENT_MEMORY_INDEX_MAX_LINES = 40;

/** Separates a conversation's title from what it was about, on one index line. */
const SUMMARY_SEPARATOR = "·";

/**
 * The last day *before* the index window, so a caller can ask for the notes
 * dated after it.
 *
 * Exclusive because that is what {@link AgentFileManager.readDailyNotesAfter}
 * takes, and because a cutoff of "today minus fourteen" then makes the window
 * exactly fourteen calendar days ending today.
 *
 * @param now - Clock the window is measured back from.
 * @param days - Window length in days; the default is the shipped window.
 */
export function agentMemoryIndexCutoff(now: Date, days: number = AGENT_MEMORY_INDEX_DAYS): string {
  const cutoff = new Date(now.getTime());
  // Stepped on the calendar rather than by hours, so a month or DST boundary
  // lands on the day the notes are named after.
  cutoff.setDate(cutoff.getDate() - days);
  return formatMemoryEntryDate(cutoff);
}

/** One index line's worth of a conversation, with the day it was held on. */
interface IndexedConversation {
  date: string;
  time: string;
  title: string;
  summary: string | null;
}

/**
 * Render the conversation index the `<agent_memory>` block carries: one line per
 * conversation heading, newest first.
 *
 * This is the whole reason the block no longer carries days of notes verbatim.
 * A line says when a conversation happened, what it was called, what it was
 * about, and which note holds the rest of it, which is enough for the agent to
 * decide whether a question reaches back into it and to open that note itself.
 * See `designdocs/CUSTOM_AGENTS.md` §5 ("Reading").
 *
 * @param notes - The daily notes inside the index window, in any order.
 * @param maxLines - How many conversations to list; the default is the shipped cap.
 * @returns The lines joined by newlines, or an empty string when the window
 *   holds no conversation at all.
 */
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
  // Reversed before the sort so that two conversations stamped with the same
  // minute keep newest-first order too: the sort is stable, and the later of
  // them is the one written further down its note.
  conversations.reverse();
  // Sorted rather than left in file order, because a day's headings are only
  // chronological while nothing but the flush has written them, and the user
  // may reorder their own notes.
  conversations.sort((a, b) =>
    a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)
  );
  return conversations
    .slice(0, Math.max(0, maxLines))
    .map((conversation) => formatIndexLine(conversation))
    .join("\n");
}

/** One conversation as the index shows it. */
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
