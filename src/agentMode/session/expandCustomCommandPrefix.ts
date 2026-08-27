import { translateCommandToAgentText } from "@/agentMode/session/translateCommandToAgentText";
import { resolveCustomCommandPrefix } from "@/commands/resolveCustomCommandPrefix";
import type { CustomCommand } from "@/commands/type";
import type { TFile } from "obsidian";

export interface ExpandCustomCommandResult {
  /** Final text to send to the backend. Equal to input when no command matched. */
  text: string;
  /** The matched command, if `input` started with `/<command-title>`. */
  matched?: CustomCommand;
}

/**
 * If `input` starts with `/<command-title>` (optionally followed by
 * whitespace + args), substitute the command's body and return it translated
 * into Agent chat syntax (see {@link translateCommandToAgentText}). Otherwise
 * return `input` unchanged.
 *
 * Args typed after the command name are appended to the command body
 * (separated by a blank line) so the translator can resolve `{}` /
 * `{copilot-selection}` against either selected text or the trailing args.
 *
 * Matching is case-insensitive on `title`. When multiple titles share a
 * prefix (e.g. `foo` and `foo-bar`), the longest match wins. The match
 * must be followed by whitespace or end-of-string so `/foobar` does not
 * match a `foo` command.
 */
export async function expandCustomCommandPrefix(
  input: string,
  commands: readonly CustomCommand[],
  selectedText: string,
  activeNote: TFile | null
): Promise<ExpandCustomCommandResult> {
  const resolved = resolveCustomCommandPrefix(input, commands);
  if (!resolved.matched) return resolved;

  const text = translateCommandToAgentText(resolved.text, selectedText, activeNote);
  return { text, matched: resolved.matched };
}
