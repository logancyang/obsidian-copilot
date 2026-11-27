import { type Document, parseDocument } from "yaml";
import { readEnabledAgents } from "@/agentMode/skills/skillFormat";

const CONFLICT_RE =
  /^<<<<<<<[^\n]*\n([\s\S]*?)(?:^\|\|\|\|\|\|\|[^\n]*\n[\s\S]*?)?^=======\r?\n([\s\S]*?)^>>>>>>>[^\n]*(?:\n|$)/gm;

function parseFrontmatter(content: string): Document.Parsed | null {
  // Only frontmatter counts: a marker in a user skill's body must never authorize replacement or deletion.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return null;
  const doc = parseDocument(frontmatter[1]);
  return doc.errors.length > 0 ? null : doc;
}

function readVersion(doc: Document.Parsed | null): number | null {
  const marker = doc?.getIn(["metadata", "copilot-builtin-version"]);
  if ((typeof marker !== "string" && typeof marker !== "number") || !/^\d+$/.test(String(marker)))
    return null;
  const version = Number(marker);
  return Number.isSafeInteger(version) ? version : null;
}

export function getBuiltinSkillVersion(content: string): number | null {
  const ours = content.replace(CONFLICT_RE, "$1");
  if (ours === content) return readVersion(parseFrontmatter(content));
  // A sync conflict between two marked copies is still Copilot's file: version 0 makes it reinstall
  // instead of staying unloadable. https://github.com/Brevilabs/obsidian-copilot-private/issues/1031
  const theirs = content.replace(CONFLICT_RE, "$2");
  return readVersion(parseFrontmatter(ours)) !== null &&
    readVersion(parseFrontmatter(theirs)) !== null
    ? 0
    : null;
}

export function getBuiltinEnabledAgents(content: string): string[] | null {
  const doc = parseFrontmatter(content);
  return readVersion(doc) === null ? null : readEnabledAgents(doc!).sort();
}
