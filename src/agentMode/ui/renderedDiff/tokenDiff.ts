import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import { diffArrays, diffLines } from "diff";

export interface StructuralLine {
  prefix: string;
  content: string;
}

export const NEARBY_MERGE_MAX_CHARS = 3;

const STRUCTURAL_PREFIX =
  /^([ \t]*(?:>[ \t]?)*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?(\[[ xX]\][ \t]+)?(#{1,6}[ \t]+)?/;

const TOKEN_PATTERNS: readonly RegExp[] = [
  /^!?\[\[[^\]\n]*\]\]/,
  /^(?:\*{1,3}|_{1,3}|~~|==)/,
  /^[ \t]+/,
];

const TAG = /^#[^\s#[\]()]+/;

interface Segment {
  kind: "equal" | "deleted" | "inserted";
  text: string;
}

export function splitStructuralPrefix(line: string): StructuralLine {
  const prefix = STRUCTURAL_PREFIX.exec(line)?.[0] ?? "";
  return { prefix, content: line.slice(prefix.length) };
}

// Links, wikilinks, inline code, tags, and emphasis runs are single tokens so a marker never lands
// inside a URL or code span, where it would break the rendered syntax.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
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

export function markDeletedLine(line: string): string {
  return markLine(line, DEL_OPEN, DEL_CLOSE);
}

export function markInsertedLine(line: string): string {
  return markLine(line, INS_OPEN, INS_CLOSE);
}

function markLine(line: string, open: string, close: string): string {
  const { prefix, content } = splitStructuralPrefix(line);
  if (content.trim() === "") return line;
  return prefix + open + content + close;
}

// Lines whose structural prefixes differ (checkbox, heading level, item number) become a deleted plus an
// inserted line: the renderer consumes that syntax, so no inline marker could show it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
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
