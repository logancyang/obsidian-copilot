import type { TFile } from "obsidian";

/** Rewrites `{activeNote}` to `[[Title]]` — the agent has no workspace context to resolve the token itself. */
export function resolveActiveNoteToken(text: string, activeFile: TFile | null): string {
  if (!activeFile) return text;
  if (!text.includes("{activeNote}")) return text;
  // Mirror NotePillNode.getTextContent: keep the extension for non-markdown attachments
  // (pdf/canvas) so the agent resolves the same path the pill envelope carries.
  const ext = activeFile.extension?.toLowerCase();
  const display =
    ext === "pdf" || ext === "canvas" ? `${activeFile.basename}.${ext}` : activeFile.basename;
  return text.split("{activeNote}").join(`[[${display}]]`);
}
