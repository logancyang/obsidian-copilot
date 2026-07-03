import { App, TFile } from "obsidian";
import type { EditDiff } from "@/agentMode/ui/editDiff";
import { rawEditPath } from "@/agentMode/ui/editDiff";
import { extractDiffContents } from "@/agentMode/ui/diffRender";
import type { ToolCallContent } from "@/agentMode/session/types";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";

interface EditRawInput {
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
}

/**
 * Synthesize a before/after `EditDiff` for a permission card, which fires
 * BEFORE the edit executes — so there is no SDK result yet and we can't reuse
 * `deriveEditDiff` (that reads a `ToolCallPart.output`; here we only have a
 * `ToolCallSnapshot`'s `rawInput` / `content`). Priority:
 *   (a) an ACP `{ type: "diff" }` already carried in `content` at permission
 *       time — the agent computed old/new for us;
 *   (b) synthesize from `rawInput`: Edit (`old_string`/`new_string`, the changed
 *       hunk is the preview) or Write (`content`, whose "before" we read from
 *       the current file — empty for a new file).
 * Returns null when no path resolves or neither source is a usable edit, so the
 * card falls back to its raw-input JSON view for non-edit tools.
 */
export async function synthesizePermissionEditDiff(
  app: App,
  toolCall: { rawInput?: unknown; content?: ToolCallContent[] | null }
): Promise<EditDiff | null> {
  const vaultBase = getVaultBase(app);

  const diffs = extractDiffContents(toolCall.content);
  if (diffs.length > 0) {
    const first = diffs[0];
    // Normalize like `deriveEditDiff`: ACP diff paths arrive raw (often
    // absolute), and the vault-relative form drives both the chip label and
    // the diff-pane leaf reuse (matched on `path`), so the pre-execution
    // preview and the post-execution ActionCard address the same tab.
    return {
      path: toVaultRelative(first.path, vaultBase),
      oldText: first.oldText ?? "",
      newText: first.newText,
    };
  }

  const rawInput = toolCall.rawInput;
  const rawPath = rawEditPath(rawInput);
  if (rawPath === null) return null;

  const path = toVaultRelative(rawPath, vaultBase);
  const input = rawInput as EditRawInput;

  if (typeof input.old_string === "string" && typeof input.new_string === "string") {
    return { path, oldText: input.old_string, newText: input.new_string };
  }

  if (typeof input.content === "string") {
    // Write: read the current file as the "before" so the preview shows the
    // real replacement, not an all-additions dump. A missing file is a create.
    const file = app.vault.getAbstractFileByPath(path);
    const oldText = file instanceof TFile ? await app.vault.read(file) : "";
    return { path, oldText, newText: input.content };
  }

  return null;
}
