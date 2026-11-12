import {
  AGENT_FILE_NAME,
  AGENT_MEMORY_FILE_NAME,
  AGENT_MEMORY_FOLDER_NAME,
} from "@/agents/constants";
import { BUILTIN_AGENT_SLUG } from "@/agents/types";
import { normalizePath } from "obsidian";

const MAX_SLUG_LENGTH = 48;

const FALLBACK_SLUG = "agent";

export function deriveAgentSlug(name: string): string {
  const slug = (name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (!slug) return FALLBACK_SLUG;
  return slug === BUILTIN_AGENT_SLUG ? `${slug}-${FALLBACK_SLUG}` : slug;
}

export function deriveUniqueAgentSlug(name: string, takenSlugs: readonly string[]): string {
  const base = deriveAgentSlug(name);
  const taken = new Set(takenSlugs.map((slug) => slug.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function getAgentFolderPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${agentsFolder}/${slug}`);
}

export function getAgentFilePath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_FILE_NAME}`);
}

export function getAgentMemoryPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_MEMORY_FILE_NAME}`);
}

export function getAgentMemoryFolderPath(agentsFolder: string, slug: string): string {
  return normalizePath(`${getAgentFolderPath(agentsFolder, slug)}/${AGENT_MEMORY_FOLDER_NAME}`);
}

export function getAgentDailyNotePath(agentsFolder: string, slug: string, date: string): string {
  return normalizePath(`${getAgentMemoryFolderPath(agentsFolder, slug)}/${date}.md`);
}

const DAILY_NOTE_FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;

export function parseAgentDailyNoteDate(fileName: string): string | null {
  const match = DAILY_NOTE_FILE_NAME.exec(fileName);
  return match ? match[1] : null;
}

export function formatAgentDailyNoteLink(date: string): string {
  return `[[${AGENT_MEMORY_FOLDER_NAME}/${date}]]`;
}
