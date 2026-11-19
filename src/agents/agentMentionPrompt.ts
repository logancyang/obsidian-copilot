import type { CustomAgent } from "@/agents/CustomAgentStore";

export const ASK_AGENT_TOOL_NAME = "ask_agent";

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function mentions(text: string, name: string): boolean {
  const needle = `@${name.toLowerCase()}`;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + needle.length] ?? "";
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

export function mentionedAgentNames(text: string, agents: readonly CustomAgent[]): string[] {
  const lower = text.toLowerCase();
  return agents.filter((agent) => mentions(lower, agent.name)).map((agent) => agent.name);
}

// Codex keeps MCP tools behind its tool search and a Copilot chat has no prompt of its own there, so the message names the tool for each agent the user mentioned.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export function agentMentionsBlock(names: readonly string[] | undefined): string | null {
  if (!names?.length) return null;
  return [
    "<copilot-agents>",
    `The user @-mentioned these custom agents in this message. Ask each of them with the ${ASK_AGENT_TOOL_NAME} tool:`,
    ...names.map((name) => `- ${name}`),
    "</copilot-agents>",
  ].join("\n");
}
