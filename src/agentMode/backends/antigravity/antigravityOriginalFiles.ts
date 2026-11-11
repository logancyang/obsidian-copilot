import type { ToolCallDelta } from "@/agentMode/session/types";

export function readAntigravityOriginalFiles(
  update: ToolCallDelta
): Record<string, string | null> | null {
  if (update.status !== "completed") return null;
  const diffs = (update.content ?? []).flatMap((item) => (item.type === "diff" ? [item] : []));
  if (diffs.length === 0) return null;
  return Object.fromEntries(
    diffs.map(({ path, oldText }) => [
      path,
      oldText == null ? null : oldText.endsWith("\n") ? oldText.slice(0, -1) : oldText,
    ])
  );
}
