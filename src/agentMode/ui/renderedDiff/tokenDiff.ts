import { alignSequences, diceSimilarity } from "@/agentMode/ui/renderedDiff/alignBlocks";
import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import { diffArrays, type ArrayChange } from "diff";

export interface StructuralLine {
  prefix: string;
  content: string;
}

const STRUCTURAL_PREFIX =
  /^([ \t]*(?:>[ \t]?)*)(\[![^\]]*\][+-]?[ \t]*)?((?:[-*+]|\d{1,9}[.)])[ \t]+)?(\[.\][ \t]+)?(#{1,6}[ \t]+)?/;

const EMPHASIS_DELIMITER = /^(?:\*{1,3}|_{1,3}|~~|==)/;

// Obsidian comments and inline math render as hidden text or TeX, where a marker inside would break them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
const TOKEN_PATTERNS: readonly RegExp[] = [
  /^!?\[\[[^\]]*\]\]/,
  /^%%.*?%%/,
  /^\$[^$\n]+\$(?!\$)/,
  // A bare URL is one token so an emphasis character inside it (`a_b`) cannot split it around a marker;
  // like an autolink it never ends on emphasis, so a delimiter wrapping it stays outside the mark.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
  /^[a-z][a-z\d+.-]*:\/\/[^\s<>*~]*[^\s<>*~_=]/i,
  EMPHASIS_DELIMITER,
  /^[ \t]+/,
];

const TAG = /^#[^\s#[\]()]+/;

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
    if (match !== null) return match[0];
  }
  const previous = index === 0 ? "" : text[index - 1];
  // Partial delimiters let diff markers corrupt link destinations and code spans.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const link = /^!?\[[^\]]*\]\(/.exec(rest);
  if (link !== null) {
    let depth = 1;
    for (const part of rest.slice(link[0].length).matchAll(/\\.|[()]/g)) {
      if (part[0] === "(") depth++;
      if (part[0] === ")" && --depth === 0) return rest.slice(0, link[0].length + part.index + 1);
    }
  }
  const opening = /^`+/.exec(rest)?.[0];
  if (opening !== undefined && previous !== "`") {
    for (const closing of rest.slice(opening.length).matchAll(/`+/g)) {
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
  // A table cell whose emphasis changed is shown whole, like a line; a cell of an added or removed row
  // has one empty side, which needs no fallback and must not leave an empty mark.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
  if (before !== "" && after !== "" && changesEmphasis(parts))
    return DEL_OPEN + before + DEL_CLOSE + INS_OPEN + after + INS_CLOSE;
  return renderInline(parts);
}

// Markers around a bare emphasis delimiter render as empty marks around restyled text, so a
// formatting edit is shown as the whole old text and the whole new text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
function changesEmphasis(parts: readonly ArrayChange<string>[]): boolean {
  return parts.some(
    (part) =>
      (part.added || part.removed) && part.value.some((token) => EMPHASIS_DELIMITER.test(token))
  );
}

function renderInline(parts: readonly ArrayChange<string>[]): string {
  return parts
    .map((part) => {
      const text = part.value.join("");
      if (part.removed) return DEL_OPEN + text + DEL_CLOSE;
      if (part.added) return INS_OPEN + text + INS_CLOSE;
      return text;
    })
    .join("");
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

// Lines whose structural prefixes differ (checkbox, heading level, callout type) become a deleted plus an
// inserted line: the renderer consumes that syntax, so no inline marker could show it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export function diffTextBlock(before: string, after: string): string {
  return alignSequences(before.split("\n"), after.split("\n"), {
    isEqual: (left, right) => left === right,
    similarity: diceSimilarity,
  })
    .flatMap((pairing) => {
      if (pairing.kind === "unchanged") return [pairing.after];
      if (pairing.kind === "deleted") return [markDeletedLine(pairing.before)];
      if (pairing.kind === "inserted") return [markInsertedLine(pairing.after)];
      return [diffModifiedLine(pairing.before, pairing.after)];
    })
    .join("\n");
}

function visibleLength(text: string): number {
  return text.replace(/\s/g, "").length;
}

function diffModifiedLine(beforeLine: string, afterLine: string): string {
  const before = splitStructuralPrefix(beforeLine);
  const after = splitStructuralPrefix(afterLine);
  const parts = diffArrays(tokenizeInline(before.content), tokenizeInline(after.content));
  // Renumbering an ordered list is not a content change, so item numbers are ignored when comparing prefixes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const samePrefix = before.prefix.replace(/\d+/g, "") === after.prefix.replace(/\d+/g, "");
  // Interleaved word marks are unreadable once most of a line is rewritten, so such a line is shown whole twice.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
  const keptLength = visibleLength(
    parts.flatMap((part) => (part.added || part.removed ? [] : part.value)).join("")
  );
  const mostlyRewritten =
    keptLength * 2 < Math.max(visibleLength(before.content), visibleLength(after.content));
  if (!samePrefix || changesEmphasis(parts) || mostlyRewritten)
    return `${markDeletedLine(beforeLine)}\n${markInsertedLine(afterLine)}`;
  return after.prefix + renderInline(parts);
}
