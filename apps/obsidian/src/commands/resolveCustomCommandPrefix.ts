import type { CustomCommand } from "@/commands/type";

export interface ResolvedCustomCommandPrefix {
  text: string;
  matched?: CustomCommand;
}

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
