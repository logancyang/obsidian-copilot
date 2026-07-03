import { diffLines } from "diff";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { toVaultRelative } from "@/utils/vaultPath";

/**
 * Backend-agnostic before/after text for a single file edit, resolved once
 * from a tool call so downstream consumers (stats, preview) never re-parse
 * the raw ACP output / vendor input shapes. Path is already vault-relative.
 */
export interface EditDiff {
  path: string;
  oldText: string;
  newText: string;
}

interface EditInput {
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
}

/**
 * The file path from an edit tool's `input`, trying the aliases different
 * backends use (`file_path` | `filePath` | `path`). Raw (not vault-relative)
 * so callers can pair it with old/new text or resolve it themselves. Shared
 * with `toolSummaries` so the alias list can't drift between the two.
 */
export function rawEditPath(input: unknown): string | null {
  const i = input as
    | { file_path?: unknown; filePath?: unknown; path?: unknown }
    | null
    | undefined;
  if (typeof i?.file_path === "string") return i.file_path;
  if (typeof i?.filePath === "string") return i.filePath;
  if (typeof i?.path === "string") return i.path;
  return null;
}

/**
 * Derive the canonical edit diff for a tool call. Priority:
 *   (a) the first `{ type: "diff" }` entry in `part.output` (ACP-style, the
 *       agent already computed old/new for us);
 *   (b) fall back to the edit tool's `input` when no diff output is present —
 *       Edit (`old_string`/`new_string`) or Write (`content`, no old_string).
 * Returns null when no path can be resolved or neither source is usable.
 */
export function deriveEditDiff(
  part: ToolCallPart,
  ctx: { vaultBase: string | null }
): EditDiff | null {
  for (const o of part.output ?? []) {
    if (o.type === "diff") {
      return {
        path: toVaultRelative(o.path, ctx.vaultBase),
        oldText: o.oldText ?? "",
        newText: o.newText,
      };
    }
  }

  const input = part.input as EditInput | null | undefined;
  if (!input) return null;

  const rawPath = rawEditPath(input);
  if (rawPath === null) return null;
  const path = toVaultRelative(rawPath, ctx.vaultBase);

  if (typeof input.old_string === "string" && typeof input.new_string === "string") {
    return { path, oldText: input.old_string, newText: input.new_string };
  }
  if (typeof input.content === "string") {
    return { path, oldText: "", newText: input.content };
  }
  return null;
}

/**
 * Real line-level added/removed counts for an edit diff. Unlike a naive
 * "every old line removed, every new line added" count, this uses jsdiff so a
 * one-line change inside a large body reports `+1 / -1`, not the file size.
 * jsdiff sets `count` to the number of lines in each change run.
 */
export function diffStats(d: EditDiff): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const change of diffLines(d.oldText, d.newText)) {
    if (change.added) added += change.count ?? 0;
    else if (change.removed) removed += change.count ?? 0;
  }
  return { added, removed };
}
