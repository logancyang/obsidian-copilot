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

// Order matters only in that a path/email match should not be re-touched by a
// later rule; the markers below contain none of the trigger characters, so the
// rules are effectively independent.
const RULES: RedactionRule[] = [
  // Home-directory usernames in absolute paths (Unix + Windows). The path shape
  // stays so the log still reads; only the identifying segment is removed.
  { pattern: /(\/(?:Users|home)\/)[^/\s"'\\:]+/g, replacement: "$1<user>" },
  { pattern: /([A-Za-z]:\\Users\\)[^\\\s"']+/gi, replacement: "$1<user>" },

  // Email addresses.
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: "<email>" },

  // Provider API keys with a recognizable prefix.
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, replacement: "<secret>" },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replacement: "<secret>" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<secret>" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: "<secret>" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "<secret>" },

  // Bearer tokens.
  { pattern: /(bearer\s+)[A-Za-z0-9._-]{12,}/gi, replacement: "$1<token>" },

  // Values of key/token/secret/password-ish fields, JSON or key=value form.
  {
    pattern:
      /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|license[_-]?key)"?\s*[:=]\s*"?)[^"'\s,}]{6,}/gi,
    replacement: "$1<redacted>",
  },
];

/** Return `text` with private data replaced by visible markers. */
export function redactLogText(text: string): string {
  return RULES.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), text);
}
