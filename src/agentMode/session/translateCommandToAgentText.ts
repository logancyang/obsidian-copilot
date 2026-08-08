import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import { ACTIVE_WEB_TAB_MARKER } from "@/constants";
import type { TFile } from "obsidian";

/**
 * Agent-chat reference for a vault file. Mirrors `NotePillNode.getTextContent`
 * and `resolveActiveNoteToken`: keep the extension only for pdf/canvas so the
 * link resolves to the same path the note pills carry.
 */
function fileToWikilink(file: TFile): string {
  const ext = file.extension?.toLowerCase();
  const display = ext === "pdf" || ext === "canvas" ? `${file.basename}.${ext}` : file.basename;
  return `[[${display}]]`;
}

// Any `{variable}` left after the selected-text and `{activeNote}` passes —
// `{[[Note]]}`, `{#tag}`, `{folder/path}`. We strip the templating braces and
// hand the bare reference to the agent rather than pre-expanding it: the agent
// has the vault as its working directory and resolves a tag (grep) or folder
// (glob/read) itself, so pre-expanding would just bloat the prompt.
const VARIABLE_REGEX = /\{([^}]+)\}/g;

/**
 * Translate a custom-command body from custom-prompt template syntax into the
 * syntax a user would type in the Agent chat: notes/tags/folders become bare
 * `[[wikilink]]` / `#tag` / `path` references the agent resolves on its own, and
 * the selected-text placeholder is inlined.
 *
 * This is the Agent-Mode counterpart to `processPrompt`. The crucial difference:
 * it never inlines note content — Agent Mode references notes by path and lets
 * the agent read them, so dumping `<variable name="activeNote">…</variable>` (as
 * `processPrompt` does) both bloats the prompt and fights the reference model.
 */
export function translateCommandToAgentText(
  body: string,
  selectedText: string,
  activeNote: TFile | null
): string {
  // Selected-text placeholders → the selection, else the active-note reference.
  // split/join (not String.replace) avoids `$&`/`$1` interpretation in the value.
  const selectionReplacement = selectedText || (activeNote ? fileToWikilink(activeNote) : "");
  let text = body.split("{copilot-selection}").join(selectionReplacement);
  text = text.split("{}").join(selectionReplacement);

  // `{activeNote}` → `[[Active Title]]`.
  text = resolveActiveNoteToken(text, activeNote);

  // Strip the templating braces off the rest, handing the bare reference
  // (`[[Note]]`, `#tag`, `folder/path`) to the agent to resolve itself.
  return text.replace(VARIABLE_REGEX, (token, rawName: string) => {
    if (token === ACTIVE_WEB_TAB_MARKER) return token; // live marker, resolved downstream
    const name = rawName.trim();
    if (name.startsWith('"')) return token; // JSON object literal, not a variable
    if (name.toLowerCase() === "activenote") return token; // no active file resolved it above
    return name;
  });
}
