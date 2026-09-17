import { AGENT_MEMORY_HEADINGS } from "@/agents/agentFile";
import { formatAgentDailyNoteLink } from "@/agents/agentPaths";

/**
 * Size budget for `MEMORY.md`, in characters.
 *
 * The curated core is re-read into every conversation with its agent, so it is
 * capped to keep that cost bounded; consolidation is asked to compress its
 * oldest entries rather than to stop recording new ones. The daily notes it is
 * distilled from are uncapped. See `designdocs/CUSTOM_AGENTS.md` §5 ("Memory").
 */
export const AGENT_MEMORY_MAX_CHARS = 8000;

/**
 * How much daily-note text one consolidation reads, in characters.
 *
 * Daily notes grow without limit, so a first consolidation after a long gap
 * could otherwise hand the model more than a context window. The most recent
 * notes are kept and older ones dropped, because what a later note says about
 * an ongoing thread is what should survive into the core
 * (`designdocs/CUSTOM_AGENTS.md` §5, "Consolidation").
 */
export const AGENT_MEMORY_NOTES_MAX_CHARS = 32000;

/** Why a returned memory file was refused and the old one kept. */
export type MemoryUpdateRejection = "empty" | "shrank" | "missing-headings";

/** Outcome of checking what the consolidation pass returned before anything is written. */
export type MemoryUpdateReview =
  | { accepted: true; text: string }
  | { accepted: false; reason: MemoryUpdateRejection };

/** `YYYY-MM-DD` in the user's own timezone, the format memory entries are dated in. */
export function formatMemoryEntryDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The calendar day before `date`, both written as `YYYY-MM-DD`.
 *
 * Steps the calendar rather than subtracting hours, so a month or year
 * boundary lands on the day the notes are actually named after.
 *
 * @param date - Day to step back from.
 */
export function previousMemoryDay(date: string): string {
  const stepped = new Date(`${date}T00:00:00`);
  stepped.setDate(stepped.getDate() - 1);
  return formatMemoryEntryDate(stepped);
}

/** Everything the flush prompt is rendered from. */
export interface AgentMemoryFlushPromptSource {
  /** Agent display name — the pass is addressed to the agent as itself. */
  agentName: string;
  /** The turns since the last flush, rendered by the shared history renderer. */
  transcript: string;
}

/** The single word a flush replies with when the conversation taught it nothing. */
export const MEMORY_FLUSH_NOTHING = "NOTHING";

/**
 * Compose the single user turn the flush pass sends.
 *
 * The agent is asked for bullets rather than for a file, because the flush
 * appends to a dated note it has never seen the whole of; deciding what the
 * note should say in full is consolidation's job, and asking for it here would
 * make every flush rewrite a day's work. See `designdocs/CUSTOM_AGENTS.md` §5
 * ("Daily notes").
 *
 * @param source - The agent and what was said since it last flushed.
 */
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

/** Leading fence with an optional language tag, and the closing fence at the end. */
const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/**
 * Unwrap a whole answer that was returned inside one code fence.
 *
 * Asking for text and getting it fenced is the most common way a model declines
 * to reply with bare text, and the fence is the only part of that answer that
 * is not the content, so it is peeled rather than treated as damage.
 */
function stripWrappingCodeFence(text: string): string {
  const match = text.trim().match(WRAPPING_CODE_FENCE);
  return match ? match[1] : text;
}

/** A markdown list marker at the start of a line, with any indentation. */
const LIST_MARKER = /^[-*+][^\S\r\n]+/;

/**
 * Read the bullets a flush replied with, dropping everything that is not one.
 *
 * Bullet markers are stripped because the note's own formatting is applied when
 * the section is rendered, and a model that answered in prose contributes its
 * lines anyway: a sentence worth keeping is worth keeping whether or not it
 * arrived with a hyphen in front of it. An empty answer, or the agreed
 * "nothing" word, yields no bullets and the caller writes nothing
 * (`designdocs/CUSTOM_AGENTS.md` §5).
 *
 * @param returned - Raw text the agent replied with.
 */
export function parseMemoryFlushBullets(returned: string): string[] {
  const text = stripWrappingCodeFence(returned).trim();
  if (text.length === 0) return [];
  if (text.toUpperCase() === MEMORY_FLUSH_NOTHING) return [];
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // A markdown heading is the model labelling its own answer, not a note.
      .filter((line) => !line.startsWith("#"))
      .map((line) => line.replace(LIST_MARKER, "").trim())
      .filter((line) => line.length > 0 && line.toUpperCase() !== MEMORY_FLUSH_NOTHING)
  );
}

/** One day of notes as consolidation reads it. */
export interface AgentDailyNoteInput {
  /** Day the note records, as `YYYY-MM-DD`; also its source anchor. */
  date: string;
  /** The note's contents. */
  text: string;
}

/** Everything the consolidation prompt is rendered from. */
export interface AgentMemoryConsolidationPromptSource {
  /** Agent display name — the pass is addressed to the agent as itself. */
  agentName: string;
  /** Body of `MEMORY.md` as it is on disk right now, user edits included. */
  currentMemory: string;
  /** Daily notes newer than `consolidated-through`, oldest first. */
  notes: readonly AgentDailyNoteInput[];
  /** Date the pass runs on; passed in so the prompt is testable. */
  today: Date;
}

/**
 * Compose the single user turn the consolidation pass sends.
 *
 * The agent is asked for the complete file rather than a patch because the
 * plugin, not the agent, owns the write: a whole-file answer is something the
 * safety rails can check in one comparison, where a patch would have to be
 * applied before it could be judged. See `designdocs/CUSTOM_AGENTS.md` §5
 * ("Consolidation").
 *
 * @param source - The agent, its current core, and the days not yet folded in.
 */
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

/** Whether `text` carries `heading` as a markdown heading line of any level. */
function hasHeading(text: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}[^\\S\\r\\n]*${escaped}[^\\S\\r\\n]*$`, "im").test(text);
}

/**
 * Decide whether what the consolidation pass returned may replace `previous`.
 *
 * Consolidation rewrites the whole curated core, so the only thing standing
 * between a bad answer and a wiped notebook is this check: a file that came
 * back empty, that lost more than half of what the user had accumulated, or
 * that dropped one of the fixed headings is refused and the old file stays. A
 * rejection is the caller's to log; the user is never shown one, because the
 * memory file is unchanged and there is nothing for them to do. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Safety rails").
 *
 * @param previous - The `MEMORY.md` body as it was on disk when the pass started.
 * @param returned - Raw text the agent replied with.
 */
export function reviewMemoryUpdate(previous: string, returned: string): MemoryUpdateReview {
  const text = stripWrappingCodeFence(returned).trim();
  if (text.length === 0) return { accepted: false, reason: "empty" };
  // Strictly more than half lost: an update that trims an equal amount of stale
  // prose and adds nothing is still a plausible compression pass.
  if (text.length * 2 < previous.trim().length) return { accepted: false, reason: "shrank" };
  for (const heading of AGENT_MEMORY_HEADINGS) {
    if (!hasHeading(text, heading)) return { accepted: false, reason: "missing-headings" };
  }
  return { accepted: true, text: `${text}\n` };
}

/**
 * Keep the most recent daily notes that fit the consolidation budget.
 *
 * Trimmed from the oldest end because a later note is what corrects an earlier
 * one, and a first consolidation after a long gap must not hand the model more
 * than it can read (`designdocs/CUSTOM_AGENTS.md` §5, "Consolidation").
 *
 * @param notes - Every note newer than `consolidated-through`, oldest first.
 * @param maxChars - Budget across all note bodies.
 */
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
    // A single day longer than the whole budget still has to be read, or a
    // heavy day would consolidate to nothing. Its tail is what a note ends on.
    if (kept.length === 0) kept.unshift({ ...note, text: note.text.slice(-maxChars) });
    break;
  }
  return kept;
}
