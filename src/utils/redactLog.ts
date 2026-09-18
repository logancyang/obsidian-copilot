/**
 * Redacts private data from diagnostic log text before it leaves the machine in
 * a bug-report bundle. A deterministic pattern pass, not a model: a frame log
 * can be tens of megabytes, so this must be fast and synchronous.
 *
 * It targets what actually leaks into these logs — home-directory usernames in
 * absolute paths (the same exposure as hiding vault-relative paths in the UI),
 * email addresses, and common secret shapes — and leaves everything else intact
 * so the log stays useful. Best-effort by design: a novel secret format can slip
 * through, so the report flow still has the user review the bundle before
 * attaching. Replacements are visible markers so a reader knows data was removed.
 */

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

/**
 * Whether a run of address-legal characters contains an email address.
 *
 * Scanned rather than pattern-matched, deliberately. A regex with a quantifier
 * on both sides of the `@` retries from every position in the run and rescans
 * it each time, which is quadratic — and a report attachment hands this whole
 * log tails, where a pasted token or a minified line is one unbroken run of
 * tens of thousands of characters. Measured on 256 KB: 30 s for the pattern
 * this replaced, against 1 ms here. Bounding the quantifiers instead was tried
 * and is worse than slow: an address longer than the bound keeps its overflow
 * as plain text, so the address survives in part.
 *
 * Deliberately loose about what counts. The caller replaces the entire run, so
 * a false positive costs a redaction marker where the text was harmless, while
 * a false negative puts a real address in a bundle that leaves the machine.
 */
const isLetter = (ch: string) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");

/** Characters that can trail an address without belonging to it. */
const TAIL_CHARS = ".-@_%+";

function runHoldsAddress(run: string): boolean {
  // The separating `@` is the first one with something other than another `@`
  // in front of it, so a run that opens with one — `@handle@host.tld`, the
  // shape a fediverse address takes — is still read as an address rather than
  // rejected for having nothing before its first `@`.
  let at = run.indexOf("@");
  while (at !== -1 && (at === 0 || run[at - 1] === "@")) at = run.indexOf("@", at + 1);
  if (at < 1) return false;
  // ANY dot after the `@` that is followed by two or more letters makes this an
  // address, not just the last one. Looking only at the last dot let a run like
  // `a@b.com@c.d` pass as "no address" on the strength of its final one-letter
  // ending, leaving the perfectly valid `a@b.com` in front of it untouched.
  // Each character is visited at most twice, so this stays linear on a run that
  // is an entire minified log line.
  for (let i = at + 2; i < run.length; i++) {
    if (run[i] !== ".") continue;
    let end = i + 1;
    while (end < run.length && isLetter(run[end])) end++;
    if (end - i - 1 >= 2) return true;
  }
  return false;
}

/**
 * Replace `run` with the email marker when it holds an address, keeping any
 * trailing punctuation the run swallowed. Without that, redacting a sentence
 * ending in an address would take the full stop with it.
 *
 * The tail is found by walking back from the end rather than by a `…$` regex.
 * That regex is anchored only at its end, so on a run whose last character is
 * not tail punctuation it retries from every interior position and rescans the
 * remainder each time — quadratic, and measurably so: 4.2 s for a 100k run.
 */
export function redactAddressRun(run: string): string {
  let end = run.length;
  while (end > 0 && TAIL_CHARS.includes(run[end - 1])) end--;
  return runHoldsAddress(run.slice(0, end)) ? `<email>${run.slice(end)}` : run;
}

/**
 * Scan address runs by their single-character separators, not a quantified
 * token regex: even a simple `+` can exhaust V8's regexp stack on a multi-MiB
 * token when optimization is unavailable. Keep pieces only for redactions,
 * not every unchanged token in a log that can be 64 MiB.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/479
 */
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

/**
 * Locate the Basic header first, then scan to a single-character delimiter.
 * Matching the entire credential with `+` can also exhaust V8's regexp stack.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/479
 */
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
    // Base64 padding belongs to the credential, up to two characters.
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

// Order matters only in that a path/email match should not be re-touched by a
// later rule; the markers below contain none of the trigger characters, so the
// rules are effectively independent.
const RULES: (RedactionRule | ((text: string) => string))[] = [
  // Home-directory usernames in absolute paths (Unix + Windows). The path shape
  // stays so the log still reads; only the identifying segment is removed.
  { pattern: /(\/(?:Users|home)\/)[^/\s"'\\:]+/g, replacement: "$1<user>" },
  { pattern: /([A-Za-z]:\\Users\\)[^\\\s"']+/gi, replacement: "$1<user>" },

  // Judge and replace a whole run so chained addresses cannot survive as a
  // leftover. Keep this after path redaction and before credential redaction.
  redactAddressRuns,

  // Provider API keys with a recognizable prefix.
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, replacement: "<secret>" },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replacement: "<secret>" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<secret>" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: "<secret>" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "<secret>" },

  // Bearer tokens.
  { pattern: /(bearer\s+)[A-Za-z0-9._-]{12,}/gi, replacement: "$1<token>" },

  // Basic credentials contain a base64-encoded password. Anchor to the
  // header name (including custom prefixes), not prose containing "basic".
  redactBasicCredentials,

  // Values of key/token/secret/password-ish fields, JSON or key=value form.
  // The AWS names are spelled out because the alternation has no word boundary
  // in front of it: `secret` does match inside `aws_secret_access_key`, but what
  // follows the match is `_access_key`, not the separator the rule needs, so a
  // compound field name only redacts when it is named whole.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  {
    pattern:
      /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|license[_-]?key|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token)"?\s*[:=]\s*"?)[^"'\s,}]{6,}/gi,
    replacement: "$1<redacted>",
  },
];

/** Return `text` with private data replaced by visible markers. */
export function redactLogText(text: string): string {
  return RULES.reduce(
    (acc, rule) =>
      typeof rule === "function" ? rule(acc) : acc.replace(rule.pattern, rule.replacement),
    text
  );
}
