import type { CustomCommand } from "@/commands/type";

export interface ResolvedCustomCommandPrefix {
  text: string;
  matched?: CustomCommand;
}

/**
 * Resolves a leading slash invocation to the saved custom-command prompt so
 * chat surfaces can share matching and trailing-instruction behavior.
 *
 * @param input - User-entered chat text that may begin with a command invocation.
 * @param commands - Custom commands available to the current chat surface.
 * @see https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610
 */
export function resolveCustomCommandPrefix(
  input: string,
  commands: readonly CustomCommand[]
): ResolvedCustomCommandPrefix {
  if (!input.startsWith("/") || input.length < 2) return { text: input };

  const afterSlash = input.slice(1);
  const lowerAfterSlash = afterSlash.toLowerCase();
  const candidates = [...commands].sort((a, b) => b.title.length - a.title.length);
  const matched = candidates.find((command) => {
    const title = command.title.toLowerCase();
    if (!lowerAfterSlash.startsWith(title)) return false;
    const next = afterSlash.charAt(title.length);
    return next === "" || /\s/.test(next);
  });
  if (!matched) return { text: input };

  const trailingInstruction = afterSlash.slice(matched.title.length).trim();
  return {
    text: trailingInstruction ? `${matched.content}\n\n${trailingInstruction}` : matched.content,
    matched,
  };
}
