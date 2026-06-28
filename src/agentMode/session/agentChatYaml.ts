/**
 * Tiny YAML-frontmatter helpers shared by `AgentChatPersistenceManager`. Kept
 * in their own module so the manager stays focused on persistence flow and
 * under the file-size budget. All functions are pure and side-effect free.
 */

/**
 * Escape a string for a safe YAML double-quoted value. Strips control chars
 * (including newlines) up front — a stray `\n` in the user's topic would
 * otherwise terminate the line and corrupt the rest of the frontmatter.
 */
export function escapeYamlString(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
  );
}

/**
 * Inverse of {@link escapeYamlString} for the values our hand-rolled
 * frontmatter parser extracts. Only handles the two escapes we emit (`\\` and
 * `\"`).
 */
export function unescapeYamlString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "\\" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "\\" || next === '"') {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/**
 * Coerce a raw frontmatter `projectId` to a trimmed string, or `undefined`
 * when absent/blank. Obsidian's YAML parser turns an unquoted numeric id into a
 * number, so accept that too.
 */
export function coerceProjectId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}
