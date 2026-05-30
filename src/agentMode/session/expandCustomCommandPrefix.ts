import { processPrompt } from "@/commands/customCommandUtils";
import type { CustomCommand } from "@/commands/type";
import type { App, TFile } from "obsidian";

export interface ExpandCustomCommandResult {
  /** Final text to send to the backend. Equal to input when no command matched. */
  text: string;
  /** The matched command, if `input` started with `/<command-title>`. */
  matched?: CustomCommand;
}

/**
 * If `input` starts with `/<command-title>` (optionally followed by
 * whitespace + args), substitute the command's body and return the
 * processed prompt. Otherwise return `input` unchanged.
 *
 * Args typed after the command name are appended to the command body
 * (separated by a blank line) so `processPrompt` can resolve `{}` /
 * `{selection}` against either selected text or the trailing args.
 *
 * Matching is case-insensitive on `title`. When multiple titles share a
 * prefix (e.g. `foo` and `foo-bar`), the longest match wins. The match
 * must be followed by whitespace or end-of-string so `/foobar` does not
 * match a `foo` command.
 */
export async function expandCustomCommandPrefix(
  input: string,
  commands: readonly CustomCommand[],
  app: App,
  selectedText: string,
  activeNote: TFile | null
): Promise<ExpandCustomCommandResult> {
  if (!input.startsWith("/") || input.length < 2) return { text: input };

  const afterSlash = input.slice(1);
  const lowerAfterSlash = afterSlash.toLowerCase();

  // Longest-first so `/foo-bar` wins over `/foo`.
  const candidates = [...commands].sort((a, b) => b.title.length - a.title.length);
  const matched = candidates.find((cmd) => {
    const title = cmd.title.toLowerCase();
    if (!lowerAfterSlash.startsWith(title)) return false;
    const next = afterSlash.charAt(title.length);
    return next === "" || /\s/.test(next);
  });
  if (!matched) return { text: input };

  const args = afterSlash.slice(matched.title.length).trim();
  const body = args ? `${matched.content}\n\n${args}` : matched.content;

  const result = await processPrompt(app, body, selectedText, app.vault, activeNote, false);
  return { text: result.processedPrompt, matched };
}
