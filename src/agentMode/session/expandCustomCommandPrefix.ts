import { translateCommandToAgentText } from "@/agentMode/session/translateCommandToAgentText";
import { resolveCustomCommandPrefix } from "@/commands/resolveCustomCommandPrefix";
import type { CustomCommand } from "@/commands/type";
import type { TFile } from "obsidian";

export interface ExpandCustomCommandResult {
  text: string;
  matched?: CustomCommand;
}

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
