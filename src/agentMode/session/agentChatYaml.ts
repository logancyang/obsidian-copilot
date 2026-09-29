import { parseYaml } from "obsidian";

const EMPTY_FRONTMATTER: Record<string, unknown> = Object.freeze({});

/**
 * Read complete YAML values for saved-chat loading, autosaving, and history.
 * Folded titles and UTF-8 BOMs must survive all three paths.
 * https://github.com/logancyang/obsidian-copilot/issues/3378
 * @param content Saved chat note including its frontmatter and transcript.
 */
export function splitAgentChatFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: EMPTY_FRONTMATTER, body: content };
  return {
    frontmatter: (parseYaml(match[1]) ?? EMPTY_FRONTMATTER) as Record<string, unknown>,
    body: normalized.slice(match[0].length).trim(),
  };
}

/**
 * Escape a string for a safe YAML double-quoted value. Strips control chars
 * (including newlines) up front — a stray `\n` in the user's topic would
 * otherwise terminate the line and corrupt the rest of the frontmatter.
 */
export function escapeYamlString(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex -- YAML scalar validation must reject embedded control bytes
      .replace(/[\x00-\x1F\x7F]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
  );
}

/**
 * Coerce a raw frontmatter `projectId` to a trimmed string, or `undefined`
 * when absent/blank. Obsidian's YAML parser turns an unquoted numeric id into a
 * number, so accept that too.
 */
export function coerceProjectId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}
