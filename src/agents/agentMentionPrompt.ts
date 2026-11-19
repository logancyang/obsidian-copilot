import type { CustomAgent } from "@/agents/CustomAgentStore";

export const ASK_AGENT_TOOL_NAME = "ask_agent";

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function withoutMentions(text: string, name: string): string {
  const needle = `@${name.toLowerCase()}`;
  let rest = text;
  for (let at = rest.indexOf(needle); at !== -1; at = rest.indexOf(needle, at + 1)) {
    const before = rest[at - 1] ?? "";
    const after = rest[at + needle.length] ?? "";
    if (WORD_CHARACTER.test(before) || WORD_CHARACTER.test(after)) continue;
    rest = rest.slice(0, at) + " ".repeat(needle.length) + rest.slice(at + needle.length);
  }
  return rest;
}

export function mentionedAgentNames(text: string, agents: readonly CustomAgent[]): string[] {
  let rest = text.toLowerCase();
  const mentioned = new Set<CustomAgent>();
  // A mention of "Maya Chen" also reads as one of "Maya", so the longest name takes its text before shorter names look.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/949
  for (const agent of [...agents].sort((a, b) => b.name.length - a.name.length)) {
    const left = withoutMentions(rest, agent.name);
    if (left !== rest) mentioned.add(agent);
    rest = left;
  }
  return agents.filter((agent) => mentioned.has(agent)).map((agent) => agent.name);
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
