import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import { ACTIVE_WEB_TAB_MARKER } from "@/constants";
import type { TFile } from "obsidian";

function fileToWikilink(file: TFile): string {
  const ext = file.extension?.toLowerCase();
  const display = ext === "pdf" || ext === "canvas" ? `${file.basename}.${ext}` : file.basename;
  return `[[${display}]]`;
}

const VARIABLE_REGEX = /\{([^}]+)\}/g;

export function translateCommandToAgentText(
  body: string,
  selectedText: string,
  activeNote: TFile | null
): string {
  const selectionReplacement = selectedText || (activeNote ? fileToWikilink(activeNote) : "");
  let text = body.split("{copilot-selection}").join(selectionReplacement);
  text = text.split("{}").join(selectionReplacement);

  text = resolveActiveNoteToken(text, activeNote);

  return text.replace(VARIABLE_REGEX, (token, rawName: string) => {
    if (token === ACTIVE_WEB_TAB_MARKER) return token;
    const name = rawName.trim();
    if (name.startsWith('"')) return token;
    if (name.toLowerCase() === "activenote") return token;
    return name;
  });
}
