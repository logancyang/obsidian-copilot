/**
 * Extracts Markdown image destinations (paths/URLs) from inline image syntax:
 * `![alt](destination "title")`.
 *
 * Supported:
 * - Non-angle destinations can include spaces: `![](foo bar.png)` (loose compatibility)
 * - Balanced parentheses in destinations: `![](foo(bar).png)`
 * - Angle destinations: `![](<path with spaces.png>)` (content inside `<...>` is trimmed)
 * - Optional titles (ignored): `"..."`, `'...'`, `( ... )`
 *
 * Note: Obsidian wiki embeds (`![[image.png]]`) are handled separately by the caller.
 */
export function extractMarkdownImagePaths(markdown: string): string[] {
  const results: string[] = [];
  let searchIndex = 0;

  while (searchIndex < markdown.length) {
    const startIndex = markdown.indexOf("![", searchIndex);
    if (startIndex === -1) {
      break;
    }

    const closeBracketIndex = findClosingBracketIndex(markdown, startIndex + 2);
    if (closeBracketIndex === null) {
      searchIndex = startIndex + 2;
      continue;
    }

    // Skip whitespace between ] and (
    let i = closeBracketIndex + 1;
    while (i < markdown.length && isWhitespaceChar(markdown[i])) {
      i++;
    }

    if (markdown[i] !== "(") {
      searchIndex = i;
      continue;
    }

    const closeParenIndex = findClosingParenIndexForImage(markdown, i);
    if (closeParenIndex === null) {
      searchIndex = i + 1;
      continue;
    }

    const destination = parseImageDestination(markdown.slice(i + 1, closeParenIndex));
    if (destination) {
      results.push(destination);
    }

    searchIndex = closeParenIndex + 1;
  }

  return results;
}

/**
 * Parses the inside of `(...)` and returns only the destination.
 *
 * Rules:
 * - Angle destinations `<...>`: content is trimmed (fixes `![](< image.png >)` → `image.png`)
 * - Non-angle destinations: supports spaces (loose compatibility), strips optional title from end
 */
function parseImageDestination(innerRaw: string): string | null {
  const inner = innerRaw.trim();
  if (inner.length === 0) {
    return null;
  }

  // Handle angle bracket destinations: `<...>`
  if (inner.startsWith("<")) {
    const closeAngleIndex = findClosingAngleBracket(inner, 0);
    if (closeAngleIndex === null) {
      return null;
    }

    // Fix: trim inside `< ... >`, so `![](< image.png >)` returns `image.png`
    const destination = inner.slice(1, closeAngleIndex).trim();
    return destination.length > 0 ? destination : null;
  }

  // Non-angle destination: strip optional title from end, keep spaces (loose compatibility)
  const destination = stripOptionalTitleFromEnd(inner).trim();
  return destination.length > 0 ? destination : null;
}

/**
 * Strips an optional trailing title from a non-angle destination string.
 * Title forms (ignored): `"..."`, `'...'`, `( ... )`, each preceded by whitespace.
 */
function stripOptionalTitleFromEnd(value: string): string {
  const s = value.trimEnd();
  if (s.length === 0) {
    return "";
  }

  const lastChar = s[s.length - 1];

  // Check for quoted title: `"..."` or `'...'`
  if (lastChar === '"' || lastChar === "'") {
    const quote = lastChar;
    const openIndex = findMatchingUnescapedQuoteFromEnd(s, quote, s.length - 1);
    if (openIndex !== null) {
      const before = s.slice(0, openIndex);
      const hasSeparator = before.length > 0 && isWhitespaceChar(before[before.length - 1]);
      if (hasSeparator) {
        return before.trimEnd();
      }
    }
  }

  // Check for parentheses title: `( ... )`
  if (lastChar === ")") {
    const openIndex = findMatchingOpeningParenForEnd(s);
    if (openIndex !== null) {
      const before = s.slice(0, openIndex);
      const hasSeparator = before.length > 0 && isWhitespaceChar(before[before.length - 1]);
      if (hasSeparator) {
        return before.trimEnd();
      }
    }
  }

  return s;
}

/**
 * Finds the closing `]` for image/link text, supporting nested brackets and backslash escapes.
 */
function findClosingBracketIndex(source: string, startIndex: number): number | null {
  let i = startIndex;
  let nestedDepth = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\") {
      i += 2;
      continue;
    }

    if (ch === "[") {
      nestedDepth++;
      i++;
      continue;
    }

    if (ch === "]") {
      if (nestedDepth === 0) {
        return i;
      }
      nestedDepth--;
      i++;
      continue;
    }

    i++;
  }

  return null;
}

/**
 * Finds the correct closing `)` for the image parens starting at `openParenIndex`.
 * Counts nested parentheses, but ignores any parentheses inside an initial `<...>` destination.
 */
function findClosingParenIndexForImage(source: string, openParenIndex: number): number | null {
  let i = openParenIndex + 1;
  let parenDepth = 1;

  let beforeDestination = true;
  let inAngleDestination = false;

  while (i < source.length) {
    const ch = source[i];

    if (inAngleDestination) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === ">") {
        inAngleDestination = false;
        beforeDestination = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (beforeDestination) {
      if (isWhitespaceChar(ch)) {
        i++;
        continue;
      }
      if (ch === "<") {
        inAngleDestination = true;
        i++;
        continue;
      }
      beforeDestination = false;
    }

    if (ch === "\\") {
      i += 2;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }

    if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        return i;
      }
      i++;
      continue;
    }

    i++;
  }

  return null;
}

/**
 * Finds the closing `>` for an angle destination starting at `openIndex` (which points to `<`).
 */
function findClosingAngleBracket(source: string, openIndex: number): number | null {
  for (let i = openIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === ">") {
      return i;
    }
  }
  return null;
}

/**
 * Finds the opening quote matching a closing quote at `closeIndex`, scanning backward.
 */
function findMatchingUnescapedQuoteFromEnd(
  source: string,
  quote: '"' | "'",
  closeIndex: number
): number | null {
  for (let i = closeIndex - 1; i >= 0; i--) {
    if (source[i] === quote && !isCharEscaped(source, i)) {
      return i;
    }
  }
  return null;
}

/**
 * Finds the matching opening `(` for a string ending in `)`, supporting nested parentheses and escapes.
 */
function findMatchingOpeningParenForEnd(source: string): number | null {
  if (source.length === 0 || source[source.length - 1] !== ")") {
    return null;
  }

  let depth = 0;

  for (let i = source.length - 1; i >= 0; i--) {
    const ch = source[i];

    if ((ch === ")" || ch === "(") && isCharEscaped(source, i)) {
      continue;
    }

    if (ch === ")") {
      depth++;
      continue;
    }

    if (ch === "(") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return null;
}

/**
 * Checks whether `source[index]` is escaped by an odd number of consecutive backslashes.
 */
function isCharEscaped(source: string, index: number): boolean {
  let backslashCount = 0;

  for (let i = index - 1; i >= 0; i--) {
    if (source[i] !== "\\") {
      break;
    }
    backslashCount++;
  }

  return backslashCount % 2 === 1;
}

/**
 * Returns true if a character is treated as whitespace for parsing.
 */
function isWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}
