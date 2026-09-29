export function renderDiff(oldText: string | null, newText: string): string {
  const lines: string[] = [];
  if (oldText !== null) {
    for (const l of oldText.split("\n")) lines.push(`- ${l}`);
  }
  for (const l of newText.split("\n")) lines.push(`+ ${l}`);
  return lines.join("\n");
}

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
