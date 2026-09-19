import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import { diffArrays, diffLines } from "diff";

/** A line separated into the structural syntax that must stay outside the diff markers. */
export interface StructuralLine {
  /** Blockquote markers, list bullet or number, task checkbox, and heading hashes. */
  prefix: string;
  content: string;
}

/**
 * Two change runs separated by no more than this many unchanged characters read
 * as one replacement; keeping them apart would scatter a single edit into
 * alternating red and green slivers.
 */
export const NEARBY_MERGE_MAX_CHARS = 3;

const STRUCTURAL_PREFIX =
  /^([ \t]*(?:>[ \t]?)*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?(\[[ xX]\][ \t]+)?(#{1,6}[ \t]+)?/;

const TOKEN_PATTERNS: readonly RegExp[] = [
  /^!?\[\[[^\]\n]*\]\]/, // wikilink or embed
  /^(?:\*{1,3}|_{1,3}|~~|==)/, // emphasis delimiter run
  /^[ \t]+/,
];

const TAG = /^#[^\s#[\]()]+/;

interface Segment {
  kind: "equal" | "deleted" | "inserted";
  text: string;
}

/**
 * Separates the syntax that makes a line a list item, task, quote, or heading from
 * the prose the diff may mark up. Markers placed after this prefix leave the
 * renderer able to produce a bullet, a checkbox, or a heading as it normally would.
 * @param line - One raw Markdown line.
 */
export function splitStructuralPrefix(line: string): StructuralLine {
  const prefix = STRUCTURAL_PREFIX.exec(line)?.[0] ?? "";
  return { prefix, content: line.slice(prefix.length) };
}

/**
 * Splits a line into the atoms the inline diff may mark independently. A wikilink,
 * a Markdown link or image, inline code, a tag, and an emphasis delimiter run are
 * each indivisible, so a marker can never land inside a URL or a code span. CJK
 * runs carry no spaces, so they are split per character.
 * @param text - Line content with its structural prefix already removed.
 */
export function tokenizeInline(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    const token = matchToken(text, index);
    if (token !== null) {
      tokens.push(token);
      index += token.length;
      continue;
    }
    if (isUnspacedScript(text[index])) {
      tokens.push(text[index]);
      index++;
      continue;
    }
    let end = index + 1;
    while (end < text.length && !isUnspacedScript(text[end]) && matchToken(text, end) === null)
      end++;
    tokens.push(text.slice(index, end));
    index = end;
  }
  return tokens;
}

/**
 * Whether a character belongs to a script written without word spaces (CJK and
 * its fullwidth and compatibility forms). Such a run has no boundaries to split
 * on, so the tokenizer falls back to one token per character.
 */
function isUnspacedScript(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

function matchToken(text: string, index: number): string | null {
  const rest = text.slice(index);
  for (const pattern of TOKEN_PATTERNS) {
    const match = pattern.exec(rest);
    if (match !== null && match[0].length > 0) return match[0];
  }
  const previous = index === 0 ? "" : text[index - 1];
  // Partial delimiters let diff markers corrupt link destinations and code spans.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const link = /^!?\[[^\]\r\n]*\]\(/.exec(rest);
  if (link !== null) {
    let depth = 1;
    for (const part of rest.slice(link[0].length).matchAll(/\\[^\r\n]|[()\r\n]/g)) {
      if (/[\r\n]/.test(part[0])) break;
      if (part[0] === "(") depth++;
      if (part[0] === ")" && --depth === 0) return rest.slice(0, link[0].length + part.index + 1);
    }
  }
  const opening = /^`+/.exec(rest)?.[0];
  if (opening !== undefined && previous !== "`") {
    for (const closing of rest.slice(opening.length).matchAll(/`+|[\r\n]/g)) {
      if (/[\r\n]/.test(closing[0])) break;
      if (closing[0].length === opening.length)
        return rest.slice(0, opening.length + closing.index + closing[0].length);
    }
  }
  if (index === 0 || /[\s([]/.test(previous)) {
    const tag = TAG.exec(rest);
    if (tag !== null) return tag[0];
  }
  return null;
}

/**
 * Diffs two versions of one line at token level and returns the merged line with
 * deletion and insertion sentinels around the changed runs.
 * @param before - Line content from the original document.
 * @param after - Line content from the edited document.
 */
export function diffInline(before: string, after: string): string {
  const parts = diffArrays(tokenizeInline(before), tokenizeInline(after));
  const segments: Segment[] = [];
  for (const part of parts) {
    const text = part.value.join("");
    if (text === "") continue;
    segments.push({ kind: part.added ? "inserted" : part.removed ? "deleted" : "equal", text });
  }
  return emitSegments(mergeNearbyRuns(segments));
}

function mergeNearbyRuns(segments: readonly Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const bridges =
      segment.kind === "equal" &&
      segment.text.length <= NEARBY_MERGE_MAX_CHARS &&
      segments[index - 1] !== undefined &&
      segments[index + 1] !== undefined &&
      segments[index - 1].kind !== "equal" &&
      segments[index + 1].kind !== "equal";
    if (bridges) {
      merged.push(
        { kind: "deleted", text: segment.text },
        { kind: "inserted", text: segment.text }
      );
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function emitSegments(segments: readonly Segment[]): string {
  let output = "";
  let index = 0;
  while (index < segments.length) {
    if (segments[index].kind === "equal") {
      output += segments[index].text;
      index++;
      continue;
    }
    let deleted = "";
    let inserted = "";
    for (; index < segments.length && segments[index].kind !== "equal"; index++) {
      if (segments[index].kind === "deleted") deleted += segments[index].text;
      else inserted += segments[index].text;
    }
    if (deleted !== "") output += DEL_OPEN + deleted + DEL_CLOSE;
    if (inserted !== "") output += INS_OPEN + inserted + INS_CLOSE;
  }
  return output;
}

/** Marks a whole line as deleted while leaving its structural prefix untouched. */
export function markDeletedLine(line: string): string {
  return markLine(line, DEL_OPEN, DEL_CLOSE);
}

/** Marks a whole line as inserted while leaving its structural prefix untouched. */
export function markInsertedLine(line: string): string {
  return markLine(line, INS_OPEN, INS_CLOSE);
}

function markLine(line: string, open: string, close: string): string {
  const { prefix, content } = splitStructuralPrefix(line);
  if (content.trim() === "") return line;
  return prefix + open + content + close;
}

/**
 * Diffs a paragraph, list, heading, quote, or callout block line by line, then
 * token by token inside lines that pair up, and returns the merged Markdown.
 *
 * Lines whose structural prefixes differ — a toggled checkbox, a changed heading
 * level, a re-numbered item — are emitted as a deleted line plus an inserted line.
 * Those changes live in the syntax the renderer consumes, so there is no inline
 * position where a marker could show them without destroying the structure.
 * @param before - Block source from the original document.
 * @param after - Block source from the edited document.
 */
export function diffTextBlock(before: string, after: string): string {
  const groups = diffLines(withTrailingNewline(before), withTrailingNewline(after)).map((part) => ({
    kind: part.added ? "inserted" : part.removed ? "deleted" : "equal",
    lines: part.value.split("\n").slice(0, -1),
  }));
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (group.kind === "equal") {
      lines.push(...group.lines);
      continue;
    }
    const next = groups[index + 1];
    if (group.kind === "deleted" && next?.kind === "inserted") {
      lines.push(...pairLines(group.lines, next.lines));
      index++;
      continue;
    }
    lines.push(...group.lines.map(group.kind === "deleted" ? markDeletedLine : markInsertedLine));
  }
  return lines.join("\n");
}

function pairLines(removed: readonly string[], added: readonly string[]): string[] {
  const lines: string[] = [];
  const paired = Math.min(removed.length, added.length);
  for (let index = 0; index < paired; index++) {
    const before = splitStructuralPrefix(removed[index]);
    const after = splitStructuralPrefix(added[index]);
    if (before.prefix !== after.prefix) {
      lines.push(markDeletedLine(removed[index]), markInsertedLine(added[index]));
      continue;
    }
    lines.push(after.prefix + diffInline(before.content, after.content));
  }
  for (let index = paired; index < removed.length; index++)
    lines.push(markDeletedLine(removed[index]));
  for (let index = paired; index < added.length; index++)
    lines.push(markInsertedLine(added[index]));
  return lines;
}

function withTrailingNewline(value: string): string {
  if (value === "") return value;
  return value.endsWith("\n") ? value : `${value}\n`;
}
