import { AGENT_MEMORY_CONSOLIDATED_THROUGH } from "@/agents/constants";
import { md5 } from "@/utils/hash";
import { parseYaml, stringifyYaml } from "obsidian";

/** Leading YAML frontmatter block, including its closing marker. */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

/** `MEMORY.md` split into the part the model reads and the bookkeeping above it. */
export interface AgentMemoryDocument {
  /** Everything below the frontmatter — the headings and their entries. */
  body: string;
  /**
   * Last daily note folded into the body, as `YYYY-MM-DD`, or null when the
   * file has never been consolidated.
   */
  consolidatedThrough: string | null;
}

/** A date written exactly the way daily notes are named. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Split a `MEMORY.md` into its consolidation bookkeeping and the body an agent
 * is given.
 *
 * Parsed leniently on purpose: every `MEMORY.md` written before consolidation
 * existed has no frontmatter at all, and the file is one the user may edit by
 * hand, so a missing, malformed, or wrongly-typed key reads as "never
 * consolidated" rather than failing the load. See
 * `designdocs/CUSTOM_AGENTS.md` §5 ("Curated core").
 *
 * @param raw - Full file contents as they are on disk.
 */
export function parseAgentMemoryFile(raw: string): AgentMemoryDocument {
  const withBom = raw || "";
  const content = withBom.startsWith("﻿") ? withBom.slice(1) : withBom;
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) return { body: content, consolidatedThrough: null };

  let consolidatedThrough: string | null = null;
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>)[AGENT_MEMORY_CONSOLIDATED_THROUGH];
      // A YAML date literal parses to a Date; a quoted one stays a string.
      const text =
        value instanceof Date ? formatIsoDay(value) : typeof value === "string" ? value.trim() : "";
      if (ISO_DAY.test(text)) consolidatedThrough = text;
    }
  } catch {
    // A hand edit in progress. The body is still the agent's memory, so keep it
    // and re-consolidate from the beginning rather than dropping the file.
  }
  // Drop the blank line the serializer puts between frontmatter and body so a
  // read/write round trip does not grow one leading newline per cycle.
  return { body: content.slice(match[0].length).replace(/^\n+/, ""), consolidatedThrough };
}

/** `YYYY-MM-DD` in the user's own timezone. */
function formatIsoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Render a `MEMORY.md` back to disk with its consolidation marker.
 *
 * The date is quoted by the YAML serializer's own rules; it is written as a
 * string so Obsidian's properties pane shows the day the user can compare
 * against a daily note's file name rather than a localized datetime.
 *
 * @param body - The headings and entries, without frontmatter.
 * @param consolidatedThrough - Last daily note folded in, or null to omit the key.
 */
export function serializeAgentMemoryFile(body: string, consolidatedThrough: string | null): string {
  const text = `${body.trim()}\n`;
  if (!consolidatedThrough) return text;
  const frontmatter = stringifyYaml({ [AGENT_MEMORY_CONSOLIDATED_THROUGH]: consolidatedThrough });
  return `---\n${frontmatter}---\n\n${text}`;
}

/**
 * Identity of a file's contents, used to notice that the user edited
 * `MEMORY.md` while a consolidation was thinking about the copy it was handed.
 *
 * @param text - File contents at the moment they were read.
 */
export function hashMemoryContent(text: string): string {
  return md5(text);
}

/** `HH:MM` in the user's own timezone — how a daily note's headings are stamped. */
export function formatDailyNoteTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** What one flush adds to a daily note: when it happened, and what was learned. */
export interface DailyNoteEntry {
  /** Time the conversation was flushed at, which stamps the heading. */
  at: Date;
  /** Chat title the heading names, so a day of work reads as a list of threads. */
  chatTitle: string;
  /** The bullets to record, each already a single line without its marker. */
  bullets: readonly string[];
}

/** Heading of a chat with no title yet, so the entry still says where it came from. */
const UNTITLED_CHAT = "Untitled chat";

/**
 * Render one flush as the section appended to a daily note: a
 * `## HH:MM <chat title>` heading and its bullets.
 *
 * The heading carries the time rather than the date because the file name is
 * already the date, and one per flush rather than one per day so a day of work
 * reads as the conversations it was made of
 * (`designdocs/CUSTOM_AGENTS.md` §5, "Daily notes").
 *
 * @param entry - The flush to render.
 */
export function buildDailyNoteSection(entry: DailyNoteEntry): string {
  const title = entry.chatTitle.trim().replace(/\s+/g, " ") || UNTITLED_CHAT;
  const bullets = entry.bullets
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0)
    .map((bullet) => `- ${bullet}`);
  return `## ${formatDailyNoteTime(entry.at)} ${title}\n\n${bullets.join("\n")}\n`;
}

/**
 * Append a section to a daily note's existing contents, or start the note when
 * there are none.
 *
 * A new day opens with an `# YYYY-MM-DD` title so the note reads as a note
 * rather than as a bare list of times.
 *
 * @param existing - Current file contents, or null when the note does not exist.
 * @param date - Day the note records, as `YYYY-MM-DD`; titles a new note.
 * @param section - Rendered section from {@link buildDailyNoteSection}.
 */
export function appendToDailyNote(existing: string | null, date: string, section: string): string {
  if (existing === null || existing.trim().length === 0) {
    return `# ${date}\n\n${section}`;
  }
  return `${existing.replace(/\s+$/, "")}\n\n${section}`;
}

/** One conversation as a daily note records it: its heading, and what it was about. */
export interface DailyNoteConversation {
  /** Time the heading is stamped with, as `HH:MM`. */
  time: string;
  /** Chat title the heading names. */
  title: string;
  /**
   * The first bullet under the heading, which is the one that says what the
   * conversation was about, or null when the heading carries no bullets (a
   * hand-written heading, or a flush whose bullets were removed).
   */
  summary: string | null;
}

/** `## HH:MM <title>` — the heading one flush writes. */
const CONVERSATION_HEADING = /^##[^\S\r\n]+([01]\d|2[0-3]):([0-5]\d)[^\S\r\n]*(.*)$/;

/** A top-level bullet, which is how a flush writes every line it records. */
const CONVERSATION_BULLET = /^[-*+][^\S\r\n]+(.*)$/;

/**
 * Read the conversations one daily note records, in the order they appear.
 *
 * Only `## HH:MM <title>` headings count. The `memory/` folder is an ordinary
 * vault folder and the note itself opens with an `# YYYY-MM-DD` title, so
 * anything else — the day's title, a heading the user typed, a line that only
 * looks like a time — is skipped rather than indexed as a conversation that
 * never happened. See `designdocs/CUSTOM_AGENTS.md` §5 ("Reading").
 *
 * @param text - The note's contents as they are on disk.
 */
export function parseDailyNoteConversations(text: string): DailyNoteConversation[] {
  const conversations: DailyNoteConversation[] = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const heading = CONVERSATION_HEADING.exec(line);
    if (heading) {
      const title = heading[3].trim().replace(/\s+/g, " ");
      conversations.push({ time: `${heading[1]}:${heading[2]}`, title, summary: null });
      continue;
    }
    const current = conversations[conversations.length - 1];
    // Only the first bullet is kept: it is the one that says what the
    // conversation was about, and the rest are what the index points at.
    if (!current || current.summary) continue;
    const bullet = CONVERSATION_BULLET.exec(line.trim());
    if (bullet && bullet[1].trim()) current.summary = bullet[1].trim().replace(/\s+/g, " ");
  }
  return conversations;
}
