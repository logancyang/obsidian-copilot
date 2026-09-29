import type { TFile } from "obsidian";

export function resolveActiveNoteToken(text: string, activeFile: TFile | null): string {
  if (!activeFile) return text;
  const ext = activeFile.extension?.toLowerCase();
  const display =
    ext === "pdf" || ext === "canvas" ? `${activeFile.basename}.${ext}` : activeFile.basename;
  return text.replace(/\{activenote\}/gi, () => `[[${display}]]`);
}
