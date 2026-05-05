/**
 * Render a tool-call diff as a single string with `- ` / `+ ` prefixes.
 * Intentionally minimal — used in the permission modal and inline tool-call
 * card. We don't pull in a full diff library; for an approval prompt the
 * side-by-side accuracy isn't worth the bundle hit.
 */
export function renderDiff(oldText: string | null, newText: string): string {
  const lines: string[] = [];
  if (oldText !== null) {
    for (const l of oldText.split("\n")) lines.push(`- ${l}`);
  }
  for (const l of newText.split("\n")) lines.push(`+ ${l}`);
  return lines.join("\n");
}

/**
 * Pretty-print a tool-call input for display. Returns null when the input is
 * absent so callers can short-circuit; falls back to `String(v)` for values
 * that can't be JSON-serialized (e.g. circular references).
 */
export function formatAgentInput(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface DiffContent {
  path: string;
  oldText: string | null;
  newText: string;
}

/**
 * Extract `{path, oldText, newText}` triples from an ACP tool-call/permission
 * `content` array. Filters out non-diff entries.
 */
export function extractDiffContents(
  content: ReadonlyArray<{
    type: string;
    path?: string;
    oldText?: string | null;
    newText?: string;
  }> | null = null
): DiffContent[] {
  if (!content) return [];
  const out: DiffContent[] = [];
  for (const item of content) {
    if (item.type === "diff" && typeof item.path === "string" && typeof item.newText === "string") {
      out.push({ path: item.path, oldText: item.oldText ?? null, newText: item.newText });
    }
  }
  return out;
}
