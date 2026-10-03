import { AGENT_MEMORY_CONSOLIDATED_THROUGH } from "@/agents/constants";
import { md5 } from "@/utils/hash";
import { parseYaml, stringifyYaml } from "obsidian";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

export interface AgentMemoryDocument {
  body: string;
  consolidatedThrough: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
      const text =
        value instanceof Date ? formatIsoDay(value) : typeof value === "string" ? value.trim() : "";
      if (ISO_DAY.test(text)) consolidatedThrough = text;
    }
  } catch {}
  return { body: content.slice(match[0].length).replace(/^\n+/, ""), consolidatedThrough };
}

function formatIsoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function serializeAgentMemoryFile(body: string, consolidatedThrough: string | null): string {
  const text = `${body.trim()}\n`;
  if (!consolidatedThrough) return text;
  const frontmatter = stringifyYaml({ [AGENT_MEMORY_CONSOLIDATED_THROUGH]: consolidatedThrough });
  return `---\n${frontmatter}---\n\n${text}`;
}

export function hashMemoryContent(text: string): string {
  return md5(text);
}

export function formatDailyNoteTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

export interface DailyNoteEntry {
  at: Date;
  chatTitle: string;
  bullets: readonly string[];
}

const UNTITLED_CHAT = "Untitled chat";

export function buildDailyNoteSection(entry: DailyNoteEntry): string {
  const title = entry.chatTitle.trim().replace(/\s+/g, " ") || UNTITLED_CHAT;
  const bullets = entry.bullets
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0)
    .map((bullet) => `- ${bullet}`);
  return `## ${formatDailyNoteTime(entry.at)} ${title}\n\n${bullets.join("\n")}\n`;
}

export function appendToDailyNote(existing: string | null, date: string, section: string): string {
  if (existing === null || existing.trim().length === 0) {
    return `# ${date}\n\n${section}`;
  }
  return `${existing.replace(/\s+$/, "")}\n\n${section}`;
}

export interface DailyNoteConversation {
  time: string;
  title: string;
  summary: string | null;
}

const CONVERSATION_HEADING = /^##[^\S\r\n]+([01]\d|2[0-3]):([0-5]\d)[^\S\r\n]*(.*)$/;

const CONVERSATION_BULLET = /^[-*+][^\S\r\n]+(.*)$/;

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
    if (!current || current.summary) continue;
    const bullet = CONVERSATION_BULLET.exec(line.trim());
    if (bullet && bullet[1].trim()) current.summary = bullet[1].trim().replace(/\s+/g, " ");
  }
  return conversations;
}
