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
  /**
   * Replacement text, or a function returning it. A function lets a rule match
   * a broad candidate and then decide, which is how the email rule stays linear
   * (see `runHoldsAddress`).
   */
  replacement: string | ((match: string) => string);
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
function redactAddressRun(run: string): string {
  let end = run.length;
  while (end > 0 && TAIL_CHARS.includes(run[end - 1])) end--;
  return runHoldsAddress(run.slice(0, end)) ? `<email>${run.slice(end)}` : run;
}

// Order matters only in that a path/email match should not be re-touched by a
// later rule; the markers below contain none of the trigger characters, so the
// rules are effectively independent.
const RULES: RedactionRule[] = [
  // Home-directory usernames in absolute paths (Unix + Windows). The path shape
  // stays so the log still reads; only the identifying segment is removed.
  { pattern: /(\/(?:Users|home)\/)[^/\s"'\\:]+/g, replacement: "$1<user>" },
  { pattern: /([A-Za-z]:\\Users\\)[^\\\s"']+/gi, replacement: "$1<user>" },

  // Email addresses. The pattern deliberately describes a *run* of address-legal
  // characters rather than an address: `runHoldsAddress` then decides, and the
  // whole run is replaced when it says yes
  // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
  //
  // Splitting it this way is what makes both properties reachable at once. A
  // single expression has to put a quantifier on each side of the `@`, and that
  // is either quadratic on a long run or, once bounded to avoid it, leaves the
  // part that did not fit. Matching the run is linear because the class has no
  // ambiguity to backtrack through, and replacing the run whole is what stops a
  // second address glued to the first — `a@b.com.c@d.com`, or an `@handle@host`
  // — from surviving as a leftover.
  { pattern: /[A-Za-z0-9._%+@-]+/g, replacement: redactAddressRun },

  // Provider API keys with a recognizable prefix.
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, replacement: "<secret>" },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replacement: "<secret>" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<secret>" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: "<secret>" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "<secret>" },

  // Bearer tokens.
  { pattern: /(bearer\s+)[A-Za-z0-9._-]{12,}/gi, replacement: "$1<token>" },

  // Basic credentials, which the field rule below cannot reach: its value
  // pattern starts after the `:`, where it finds the five-character scheme word
  // rather than the credential. What follows the word is base64 of
  // `user:password`, so leaving it is leaving both. Anchored to the header name
  // rather than matching `basic` anywhere, which would eat the next word of any
  // sentence using it — "the basic principle" — and leave the log less
  // diagnostic than it found it. The quote either side of the separator is what
  // carries the JSON spelling, which is the one the frame log actually holds:
  // it stores SDK and ACP payloads as NDJSON, so a request's headers arrive as
  // `"authorization": "Basic ..."` rather than as a raw header line.
  //
  // The credential is matched with `+` rather than a minimum length. Once the
  // header name and scheme are established there is nothing left to qualify —
  // `dTpw` is four characters and decodes to `u:p` — and a counted lower bound
  // costs more than it buys: V8 walks `{n,}` in a way that exhausts the regexp
  // stack, which a log holding one unbroken multi-megabyte token reaches, and
  // the throw takes the whole report down with it. The gap before it is spaces
  // and tabs rather than any whitespace, so a header whose credential is empty
  // ends at its own line instead of claiming the first word of the next one.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
  {
    pattern: /(authorization"?\s*[:=]\s*"?basic[ \t]+)[A-Za-z0-9+/]+={0,2}/gi,
    replacement: "$1<redacted>",
  },

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
  // The two branches are the same call: `replace` is overloaded on the
  // replacement rather than taking a union, so the type has to be narrowed
  // before it will resolve.
  return RULES.reduce(
    (acc, rule) =>
      typeof rule.replacement === "string"
        ? acc.replace(rule.pattern, rule.replacement)
        : acc.replace(rule.pattern, rule.replacement),
    text
  );
}
