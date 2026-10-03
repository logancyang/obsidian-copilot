import { AGENT_MEMORY_HEADINGS } from "@/agents/agentFile";
import { formatAgentDailyNoteLink } from "@/agents/agentPaths";

export const AGENT_MEMORY_MAX_CHARS = 8000;

export const AGENT_MEMORY_NOTES_MAX_CHARS = 32000;

export type MemoryUpdateRejection = "empty" | "shrank" | "missing-headings";

export type MemoryUpdateReview =
  | { accepted: true; text: string }
  | { accepted: false; reason: MemoryUpdateRejection };

export function formatMemoryEntryDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function previousMemoryDay(date: string): string {
  const stepped = new Date(`${date}T00:00:00`);
  stepped.setDate(stepped.getDate() - 1);
  return formatMemoryEntryDate(stepped);
}

export interface AgentMemoryFlushPromptSource {
  agentName: string;
  transcript: string;
}

export const MEMORY_FLUSH_NOTHING = "NOTHING";

export function buildAgentMemoryFlushPrompt(source: AgentMemoryFlushPromptSource): string {
  const name = source.agentName.trim() || "this agent";
  return [
    `You are ${name}. Below is part of a conversation you have been having with ` +
      `this user. Write down what is worth remembering from it, the way you would ` +
      `jot notes to yourself at the end of a working session.`,
    `## What was said\n${source.transcript.trim()}`,
    [
      "## What to write down",
      "- First, one bullet saying what this conversation was about: what the " +
        "user asked for and what you did or answered, in one line, naming the " +
        'specific decision, fact, or result rather than the topic ("decided the ' +
        'intro is always one paragraph", not "discussed intro length"). Every ' +
        "conversation gets this bullet; it is the line a later chat reads first, " +
        "so that you can later say what the two of you talked about today.",
      "- Then one bullet per thing worth keeping, each a single line that stands " +
        "on its own: who the user is, their preferences, their standing " +
        "requests, open threads, and decisions they made. Never retell the " +
        "conversation turn by turn.",
      "- Say what changed when this conversation overturned something you " +
        "believed, so the correction is on the record.",
      "- Leave out anything you would not want to read back weeks from now.",
    ].join("\n"),
    `Reply with the bullets and nothing else: no heading, no preamble, no code ` +
      `fences. Only when the user said nothing of substance, a greeting or a ` +
      `test message, reply with the single word ${MEMORY_FLUSH_NOTHING}.`,
  ].join("\n\n");
}

const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

function stripWrappingCodeFence(text: string): string {
  const match = text.trim().match(WRAPPING_CODE_FENCE);
  return match ? match[1] : text;
}

const LIST_MARKER = /^[-*+][^\S\r\n]+/;

export function parseMemoryFlushBullets(returned: string): string[] {
  const text = stripWrappingCodeFence(returned).trim();
  if (text.length === 0) return [];
  if (text.toUpperCase() === MEMORY_FLUSH_NOTHING) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.replace(LIST_MARKER, "").trim())
    .filter((line) => line.length > 0 && line.toUpperCase() !== MEMORY_FLUSH_NOTHING);
}

export interface AgentDailyNoteInput {
  date: string;
  text: string;
}

export interface AgentMemoryConsolidationPromptSource {
  agentName: string;
  currentMemory: string;
  notes: readonly AgentDailyNoteInput[];
  today: Date;
}

export function buildAgentMemoryConsolidationPrompt(
  source: AgentMemoryConsolidationPromptSource
): string {
  const name = source.agentName.trim() || "this agent";
  const headings = AGENT_MEMORY_HEADINGS.map((heading) => `"${heading}"`).join(", ");
  const notes = source.notes.map((note) => `### ${note.date}\n${note.text.trim()}`).join("\n\n");
  return [
    `You are ${name}. You keep a curated memory file about this user, and a ` +
      `folder of dated notes you write while you work. Fold the notes below into ` +
      `the file so that what you carry into every conversation stays small, true, ` +
      `and current.`,
    `## Your memory file as it stands\n${source.currentMemory.trim()}`,
    `## Notes you have not folded in yet\n${notes || "(none)"}`,
    [
      "## How to rewrite the file",
      "- Keep what is still true, and merge duplicate entries into one.",
      "- Retire what a later note contradicted, and say so in the entry that " +
        "replaces it rather than deleting it silently.",
      "- Keep only durable facts: who the user is, their preferences, their " +
        "standing requests, open threads, and decisions. Never copy a note across " +
        "verbatim and never store a conversation.",
      `- Date every entry \`(${formatMemoryEntryDate(source.today)})\` or with the ` +
        "date it was already carrying.",
      `- End every entry with a link to the note it came from, written exactly ` +
        `like ${formatAgentDailyNoteLink(formatMemoryEntryDate(source.today))}. An ` +
        `entry you are keeping unchanged keeps the link it already had.`,
      `- Keep these headings, spelled exactly this way and in this order, even where a section is empty: ${headings}.`,
      `- Keep the whole file under ${AGENT_MEMORY_MAX_CHARS} characters. When it would ` +
        "go over, compress the oldest entries first.",
    ].join("\n"),
    "Reply with the complete new contents of the memory file and nothing else: no " +
      "preamble, no explanation, no code fences, no YAML frontmatter.",
  ].join("\n\n");
}

function hasHeading(text: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}[^\\S\\r\\n]*${escaped}[^\\S\\r\\n]*$`, "im").test(text);
}

export function reviewMemoryUpdate(previous: string, returned: string): MemoryUpdateReview {
  const text = stripWrappingCodeFence(returned).trim();
  if (text.length === 0) return { accepted: false, reason: "empty" };
  if (text.length * 2 < previous.trim().length) return { accepted: false, reason: "shrank" };
  for (const heading of AGENT_MEMORY_HEADINGS) {
    if (!hasHeading(text, heading)) return { accepted: false, reason: "missing-headings" };
  }
  return { accepted: true, text: `${text}\n` };
}

export function boundConsolidationNotes(
  notes: readonly AgentDailyNoteInput[],
  maxChars: number = AGENT_MEMORY_NOTES_MAX_CHARS
): AgentDailyNoteInput[] {
  const kept: AgentDailyNoteInput[] = [];
  let used = 0;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    if (used + note.text.length <= maxChars) {
      kept.unshift(note);
      used += note.text.length;
      continue;
    }
    if (kept.length === 0) kept.unshift({ ...note, text: note.text.slice(-maxChars) });
    break;
  }
  return kept;
}
