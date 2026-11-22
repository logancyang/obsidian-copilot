import type { CustomAgent } from "@/agents/CustomAgentStore";

export function agentTitle({ title, instruction }: Pick<CustomAgent, "title" | "instruction">) {
  if (title.trim()) return title.trim();
  // An agent made without a title shows its instruction's first sentence wherever a title shows.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
  const firstLine = instruction
    .split("\n")
    .map((line) => line.replace(/^[\s#>*-]+/, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";
  return firstLine.match(/^.+?[.!?。！？](?=\s|$)/)?.[0] ?? firstLine;
}
