import { createTwoFilesPatch, OMIT_HEADERS } from "diff";

/**
 * Render changed hunks with three context lines, preserving Markdown whitespace.
 * @param oldText - Before snapshot, or null for a newly created file.
 * @param newText - Complete proposed or completed after snapshot.
 */
export function renderDiff(oldText: string | null, newText: string): string {
  // Whole-file dumps hide small edits; trimmed comparisons hide Markdown hard breaks:
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/350
  return (
    createTwoFilesPatch("", "", oldText ?? "", newText, undefined, undefined, {
      context: 3,
      headerOptions: OMIT_HEADERS,
    }).slice(0, -1) || "No changes"
  );
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
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    return String(Object.prototype.toString.call(v));
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
