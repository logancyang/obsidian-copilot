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

// Quote and list markers repeat in any order because a list item can open a blockquote (`- > Quote`).
// https://github.com/Brevilabs/obsidian-copilot-private/issues/348
const STRUCTURAL_PREFIX =
  /^[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:\[![^\]]*\][+-]?[ \t]*)?(?:\[.\][ \t]+)?(?:#{1,6}[ \t]+)?/;

const ORDERED_LIST_NUMBER = /\d+(?=[.)])/g;

const HARD_BREAK = / {2,}$/;

const EMPHASIS_DELIMITER = /^(?:\*{1,3}|_{1,3}|~~|==)/;

// Inline math renders as TeX, where a marker inside would break it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
const TOKEN_PATTERNS: readonly RegExp[] = [
  /^!?\[\[[^\]]*\]\]/,
  /^\$(?:\\.|[^$\\\n])+\$(?!\$)/,
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
  const body = content.trimEnd();
  if (body === "") return line;
  return prefix + open + body + close + content.slice(body.length);
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

function isMostlyRewritten(
  parts: readonly ArrayChange<string>[],
  before: string,
  after: string
): boolean {
  const keptLength = visibleLength(
    parts.flatMap((part) => (part.added || part.removed ? [] : part.value)).join("")
  );
  return keptLength * 2 < Math.max(visibleLength(before), visibleLength(after));
}

const SENTENCE_END = /[.!?]["')\]]*$/;

const UNSPACED_SENTENCE_END = /^[。！？]$/;

const WHITESPACE = /^[ \t]+$/;

// A sentence never ends inside an emphasis span: a mark around half of one would hold an unclosed
// delimiter and break the rendered formatting.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  const openEmphasis: string[] = [];
  let sentence = "";
  let terminated = false;
  for (const token of tokenizeInline(text)) {
    const closed = openEmphasis.length === 0;
    if (closed && terminated && WHITESPACE.test(token)) {
      pieces.push(sentence);
      sentence = token;
      terminated = false;
      continue;
    }
    sentence += token;
    if (EMPHASIS_DELIMITER.test(token)) {
      if (openEmphasis[openEmphasis.length - 1] === token) openEmphasis.pop();
      else openEmphasis.push(token);
      continue;
    }
    terminated = SENTENCE_END.test(token);
    if (closed && UNSPACED_SENTENCE_END.test(token)) {
      pieces.push(sentence);
      sentence = "";
    }
  }
  if (sentence !== "") pieces.push(sentence);
  return pieces;
}

// Common words shared by a rewritten sentence and its replacement chop the rewrite into scattered
// word marks, so each changed stretch of sentences is judged alone and replaced whole once most of
// it is rewritten, however much unchanged text surrounds it on the line.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/349
function diffSentences(before: string, after: string): string | null {
  const parts = diffArrays(splitSentences(before), splitSentences(after));
  if (parts.every((part) => part.added || part.removed)) return null;
  let merged = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      merged += part.value.join("");
      continue;
    }
    const next = parts[index + 1];
    const replacement = part.removed && next?.added ? next : undefined;
    if (replacement) index++;
    merged += diffStretch(
      part.removed ? part.value.join("") : "",
      (replacement ?? (part.added ? part : undefined))?.value.join("") ?? ""
    );
  }
  return merged;
}

function diffStretch(before: string, after: string): string {
  const parts = diffArrays(tokenizeInline(before), tokenizeInline(after));
  if (!isMostlyRewritten(parts, before, after)) return renderInline(parts);
  const framing = after.trim() === "" ? before : after;
  const body = framing.trim();
  const start = framing.indexOf(body);
  return (
    framing.slice(0, start) +
    markStretch(before, DEL_OPEN, DEL_CLOSE) +
    markStretch(after, INS_OPEN, INS_CLOSE) +
    framing.slice(start + body.length)
  );
}

function markStretch(text: string, open: string, close: string): string {
  const body = text.trim();
  return body === "" ? "" : open + body + close;
}

function diffModifiedLine(beforeLine: string, afterLine: string): string {
  const before = splitStructuralPrefix(beforeLine);
  const after = splitStructuralPrefix(afterLine);
  const beforeBody = before.content.trimEnd();
  const afterBody = after.content.trimEnd();
  const parts = diffArrays(tokenizeInline(beforeBody), tokenizeInline(afterBody));
  // Renumbering an ordered list is not a content change, so item numbers are ignored when comparing prefixes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const samePrefix =
    before.prefix.replace(ORDERED_LIST_NUMBER, "") ===
    after.prefix.replace(ORDERED_LIST_NUMBER, "");
  // Trailing spaces are a hard break only while they end the line, so they stay outside marks and a
  // gained or lost break is shown like other syntax the renderer consumes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/348
  const sameBreak = HARD_BREAK.test(beforeLine) === HARD_BREAK.test(afterLine);
  if (!samePrefix || !sameBreak || changesEmphasis(parts))
    return markedLines(beforeLine, afterLine);
  let merged = diffSentences(beforeBody, afterBody);
  if (merged === null) {
    // Interleaved word marks are unreadable once most of a line is rewritten, so such a line is shown whole twice.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/349
    if (isMostlyRewritten(parts, beforeBody, afterBody)) return markedLines(beforeLine, afterLine);
    merged = renderInline(parts);
  }
  return after.prefix + merged + after.content.slice(afterBody.length);
}

function markedLines(beforeLine: string, afterLine: string): string {
  return `${markDeletedLine(beforeLine)}\n${markInsertedLine(afterLine)}`;
}
