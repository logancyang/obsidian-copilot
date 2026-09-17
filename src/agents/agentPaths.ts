import {
  AGENT_FILE_NAME,
  AGENT_MEMORY_FILE_NAME,
  AGENT_MEMORY_FOLDER_NAME,
} from "@/agents/constants";
import { BUILTIN_AGENT_SLUG } from "@/agents/types";
import { normalizePath } from "obsidian";

/**
 * Longest slug we will derive. Long enough for any sensible persona name and
 * short enough that `<vault>/<root>/agents/<slug>/MEMORY.md` stays well inside
 * the 255-byte path-segment limit every supported filesystem enforces.
 */
const MAX_SLUG_LENGTH = 48;

/** Fallback when a name contains nothing a slug can be built from (e.g. "🙂🙂"). */
const FALLBACK_SLUG = "agent";

/**
 * Derive an agent's folder name from its display name.
 *
 * The result is the agent's permanent identity — it is what chats and `@`
 * mentions persist — so it is deliberately narrow: lowercase ASCII words joined
 * by single hyphens. That keeps it typeable in a mention, stable across
 * case-insensitive filesystems, and free of the separators and reserved
 * characters a vault path cannot carry.
 *
 * @param name - Display name the user typed.
 */
export function deriveAgentSlug(name: string): string {
  const slug = (name || "")
    .normalize("NFKD")
    // Drop combining marks so "Renée" slugs as "renee" rather than losing the e.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (!slug) return FALLBACK_SLUG;
  // `copilot` names the built-in assistant, which has no folder. A folder
  // claiming it would shadow an entry the picker must always be able to offer.
  // See designdocs/CUSTOM_AGENTS.md §2.
  return slug === BUILTIN_AGENT_SLUG ? `${slug}-${FALLBACK_SLUG}` : slug;
}

/**
 * Pick a free slug by appending `-2`, `-3`, … to the derived one.
 *
 * Two agents may legitimately share a display name, and the folder name has to
 * differ anyway, so a collision suffixes rather than rejecting the create.
 * Comparison is case-insensitive because macOS and Windows vaults cannot hold
 * `Jennifer/` and `jennifer/` side by side.
 *
 * @param name - Display name the user typed.
 * @param takenSlugs - Slugs already in use under the agents folder.
 */
export function deriveUniqueAgentSlug(name: string, takenSlugs: readonly string[]): string {
  const base = deriveAgentSlug(name);
  const taken = new Set(takenSlugs.map((slug) => slug.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Vault-relative folder of one agent. */
export function getAgentFolderPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${agentsFolder}/${slug}`);
}

/** Vault-relative path of one agent's `agent.md`. */
export function getAgentFilePath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_FILE_NAME}`);
}

/** Vault-relative path of one agent's `MEMORY.md`. */
export function getAgentMemoryPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_MEMORY_FILE_NAME}`);
}

/** Vault-relative folder of one agent's daily notes, `<agent>/memory`. */
export function getAgentMemoryFolderPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_MEMORY_FOLDER_NAME}`);
}

/**
 * Vault-relative path of one agent's daily note for `date`.
 *
 * @param date - Day the note records, as `YYYY-MM-DD`.
 */
export function getAgentDailyNotePath(agentsFolder: string, slug: string, date: string): string {
  return normalizePath(`${getAgentMemoryFolderPath(agentsFolder, slug)}/${date}.md`);
}

/** A daily note's file name: the date it records, and nothing else. */
const DAILY_NOTE_FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * The day a file in the `memory/` folder records, or null when its name is not
 * a date.
 *
 * The folder is an ordinary vault folder, so the user may keep their own notes
 * beside the dated ones; anything unnamed is left alone rather than read as
 * memory (`designdocs/CUSTOM_AGENTS.md` §5).
 *
 * @param fileName - File name with its extension, as the vault reports it.
 */
export function parseAgentDailyNoteDate(fileName: string): string | null {
  const match = DAILY_NOTE_FILE_NAME.exec(fileName);
  return match ? match[1] : null;
}

/**
 * The wikilink a consolidated `MEMORY.md` entry cites its source day with, so a
 * user can trace any fact back to the day it was learned.
 *
 * Relative to the agent's own folder, which is where `MEMORY.md` sits, so the
 * link resolves when the note is opened (`designdocs/CUSTOM_AGENTS.md` §5).
 *
 * @param date - Day the entry came from, as `YYYY-MM-DD`.
 */
export function formatAgentDailyNoteLink(date: string): string {
  return `[[${AGENT_MEMORY_FOLDER_NAME}/${date}]]`;
}
