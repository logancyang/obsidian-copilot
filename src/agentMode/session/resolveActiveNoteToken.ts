import type { TFile } from "obsidian";

/** Rewrites `{activeNote}` to `[[Title]]` — the agent has no workspace context to resolve the token itself. */
export function resolveActiveNoteToken(text: string, activeFile: TFile | null): string {
  if (!activeFile) return text;
  if (!text.includes("{activeNote}")) return text;
  return text.split("{activeNote}").join(`[[${activeFile.basename}]]`);
}
