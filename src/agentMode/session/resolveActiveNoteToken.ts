import type { TFile } from "obsidian";

/**
 * Replace the literal `{activeNote}` token (emitted by `ActiveNotePillNode`
 * via `getTextContent()`) with the `[[Note Title]]` wikilink form the agent
 * already knows how to handle.
 *
 * Why this exists: the active file is a client-side concept that exists only
 * inside the Obsidian workspace. The agent (running in a separate process /
 * SDK) has no way to ask "what is the user currently viewing?", so the
 * resolution has to happen on the host before the message is sent. The
 * companion `ActiveNotePillSyncPlugin` already auto-attaches the active file
 * to the `<copilot-context>` envelope, so once the inline token is rewritten,
 * the agent can `read` the note by the path the envelope carries.
 *
 * When no active note is available, the token is left untouched. The
 * pill-syntax directive tells the agent how to interpret the literal — the
 * agent will tell the user no note is currently active rather than guess.
 */
export function resolveActiveNoteToken(text: string, activeFile: TFile | null): string {
  if (!activeFile) return text;
  if (!text.includes("{activeNote}")) return text;
  return text.split("{activeNote}").join(`[[${activeFile.basename}]]`);
}
