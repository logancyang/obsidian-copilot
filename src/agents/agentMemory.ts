import { AGENT_MEMORY_HEADINGS } from "@/agents/agentFile";

/**
 * Size budget for `MEMORY.md`, in characters.
 *
 * A memory file is re-read into every conversation with its agent, so it is
 * capped to keep that cost bounded; the prompt asks the agent to compress its
 * oldest entries rather than to stop recording new ones. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Memory").
 */
export const AGENT_MEMORY_MAX_CHARS = 8000;

/** Why a returned memory file was refused and the old one kept. */
export type MemoryUpdateRejection = "empty" | "shrank" | "missing-headings";

/** Outcome of checking what the memory pass returned before anything is written. */
export type MemoryUpdateReview =
  | { accepted: true; text: string }
  | { accepted: false; reason: MemoryUpdateRejection };

/** `YYYY-MM-DD` in the user's own timezone, the format memory entries are dated in. */
export function formatMemoryEntryDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Everything the memory-update prompt is rendered from. */
export interface AgentMemoryPromptSource {
  /** Agent display name — the pass is addressed to the agent as itself. */
  agentName: string;
  /** `MEMORY.md` exactly as it is on disk right now, user edits included. */
  currentMemory: string;
  /** The turns since the last update, rendered by the shared history renderer. */
  transcript: string;
  /** Date new entries are stamped with; passed in so the prompt is testable. */
  today: Date;
}

/**
 * Compose the single user turn the memory pass sends.
 *
 * The agent is asked for the complete file rather than a patch because the
 * plugin, not the agent, owns the write: a whole-file answer is something the
 * safety rails can check in one comparison, where a patch would have to be
 * applied before it could be judged. See `designdocs/CUSTOM_AGENTS.md` §5.
 *
 * @param source - The agent, its current file, and what was said since.
 */
export function buildAgentMemoryPrompt(source: AgentMemoryPromptSource): string {
  const name = source.agentName.trim() || "this agent";
  const headings = AGENT_MEMORY_HEADINGS.map((heading) => `"${heading}"`).join(", ");
  return [
    `You are ${name}. The conversation below has ended. Update your own long-term ` +
      `memory file so that the next time you talk to this user you remember what matters.`,
    `## Your memory file as it stands\n${source.currentMemory.trim()}`,
    `## What was said since you last updated it\n${source.transcript.trim()}`,
    [
      "## How to update it",
      "- Keep what is still true, and merge duplicate entries into one.",
      "- Drop what this conversation contradicted, and say so in the entry that " +
        "replaces it rather than deleting it silently.",
      "- Add only what is worth knowing next time: who the user is, their " +
        "preferences, their standing requests, open threads, and decisions. Never " +
        "store the conversation itself.",
      `- Date every entry you add or change \`(${formatMemoryEntryDate(source.today)})\`.`,
      `- Keep these headings, spelled exactly this way and in this order, even where a section is empty: ${headings}.`,
      `- Keep the whole file under ${AGENT_MEMORY_MAX_CHARS} characters. When it would ` +
        "go over, compress the oldest entries first.",
    ].join("\n"),
    "Reply with the complete new contents of the memory file and nothing else: no " +
      "preamble, no explanation, no code fences.",
  ].join("\n\n");
}

/** Leading fence with an optional language tag, and the closing fence at the end. */
const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/**
 * Unwrap a whole answer that was returned inside one code fence.
 *
 * Asking for a file and getting it fenced is the most common way a model
 * declines to reply with bare text, and the fence is the only part of that
 * answer that is not the file, so it is peeled rather than treated as damage.
 */
function stripWrappingCodeFence(text: string): string {
  const match = text.trim().match(WRAPPING_CODE_FENCE);
  return match ? match[1] : text;
}

/** Whether `text` carries `heading` as a markdown heading line of any level. */
function hasHeading(text: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}[^\\S\\r\\n]*${escaped}[^\\S\\r\\n]*$`, "im").test(text);
}

/**
 * Decide whether what the memory pass returned may replace `previous`.
 *
 * The agent writes its own memory, so the only thing standing between a bad
 * answer and a wiped notebook is this check: a file that came back empty, that
 * lost more than half of what the user had accumulated, or that dropped one of
 * the fixed headings is refused and the old file stays. A rejection is the
 * caller's to log; the user is never shown one, because the memory file is
 * unchanged and there is nothing for them to do. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Safety rails").
 *
 * @param previous - `MEMORY.md` as it was on disk when the pass started.
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
