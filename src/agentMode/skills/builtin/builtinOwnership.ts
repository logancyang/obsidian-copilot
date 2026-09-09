import { parseDocument } from "yaml";

/**
 * Recognize owned content only through an actual frontmatter metadata marker.
 * @param content - Complete SKILL.md contents; Markdown examples confer no ownership.
 */
export function getBuiltinSkillVersion(content: string): number | null {
  // A marker shown in the body of a user skill must never authorize replacement or deletion.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return null;
  const doc = parseDocument(frontmatter[1]);
  if (doc.errors.length > 0) return null;
  const marker = doc.getIn(["metadata", "copilot-builtin-version"]);
  if ((typeof marker !== "string" && typeof marker !== "number") || !/^\d+$/.test(String(marker)))
    return null;
  const version = Number(marker);
  return Number.isSafeInteger(version) ? version : null;
}
