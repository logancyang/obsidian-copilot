interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const isLetter = (ch: string) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");

const TAIL_CHARS = ".-@_%+";

function runHoldsAddress(run: string): boolean {
  let at = run.indexOf("@");
  while (at !== -1 && (at === 0 || run[at - 1] === "@")) at = run.indexOf("@", at + 1);
  if (at < 1) return false;
  for (let i = at + 2; i < run.length; i++) {
    if (run[i] !== ".") continue;
    let end = i + 1;
    while (end < run.length && isLetter(run[end])) end++;
    if (end - i - 1 >= 2) return true;
  }
  return false;
}

export function redactAddressRun(run: string): string {
  let end = run.length;
  while (end > 0 && TAIL_CHARS.includes(run[end - 1])) end--;
  return runHoldsAddress(run.slice(0, end)) ? `<email>${run.slice(end)}` : run;
}

// Scan by single-character separators: a quantified token regex can exhaust V8's regexp stack on a multi-MiB token.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/479
function redactAddressRuns(text: string): string {
  const separators = /[^A-Za-z0-9._%+@-]/g;
  const pieces: string[] = [];
  let gapStart = 0;
  let runStart = 0;
  for (;;) {
    const separator = separators.exec(text);
    const runEnd = separator?.index ?? text.length;
    const run = text.slice(runStart, runEnd);
    const replaced = redactAddressRun(run);
    if (replaced !== run) {
      pieces.push(text.slice(gapStart, runStart), replaced);
      gapStart = runEnd;
    }
    if (separator === null) break;
    runStart = runEnd + 1;
  }
  if (pieces.length === 0) return text;
  pieces.push(text.slice(gapStart));
  return pieces.join("");
}

// Scan to a single-character delimiter: matching the credential with `+` can exhaust V8's regexp stack.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/479
function redactBasicCredentials(text: string): string {
  const headers = /authorization"?\s*[:=]\s*"?basic[ \t]+/gi;
  const delimiters = /[^A-Za-z0-9+/]/g;
  const pieces: string[] = [];
  let gapStart = 0;
  for (let header = headers.exec(text); header !== null; header = headers.exec(text)) {
    const tokenStart = headers.lastIndex;
    delimiters.lastIndex = tokenStart;
    let tokenEnd = delimiters.exec(text)?.index ?? text.length;
    if (tokenEnd === tokenStart) continue;
    if (text[tokenEnd] === "=") tokenEnd++;
    if (text[tokenEnd] === "=") tokenEnd++;
    pieces.push(text.slice(gapStart, tokenStart), "<redacted>");
    gapStart = tokenEnd;
    headers.lastIndex = tokenEnd;
  }
  if (pieces.length === 0) return text;
  pieces.push(text.slice(gapStart));
  return pieces.join("");
}

const RULES: (RedactionRule | ((text: string) => string))[] = [
  { pattern: /(\/(?:Users|home)\/)[^/\s"'\\:]+/g, replacement: "$1<user>" },
  { pattern: /([A-Za-z]:\\Users\\)[^\\\s"']+/gi, replacement: "$1<user>" },

  redactAddressRuns,

  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, replacement: "<secret>" },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replacement: "<secret>" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<secret>" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: "<secret>" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "<secret>" },

  { pattern: /(bearer\s+)[A-Za-z0-9._-]{12,}/gi, replacement: "$1<token>" },

  redactBasicCredentials,

  // The AWS field names are spelled out because the alternation has no leading word boundary, so a compound name redacts only when named whole.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  {
    pattern:
      /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|license[_-]?key|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token)"?\s*[:=]\s*"?)[^"'\s,}]{6,}/gi,
    replacement: "$1<redacted>",
  },
];

export function redactLogText(text: string): string {
  return RULES.reduce(
    (acc, rule) =>
      typeof rule === "function" ? rule(acc) : acc.replace(rule.pattern, rule.replacement),
    text
  );
}
