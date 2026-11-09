import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { CopilotToolCall, CopilotToolUse } from "@/agentMode/session/copilotToolCalls";

const CODE_EXTERNAL_ACCESS = /\b(?:tools|fetch)\b/g;
const CODE_COPILOT_TOOL_CALL = new RegExp(
  `\\btools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\](?:\\.(\\w+)|\\[["']([\\w-]+)["']\\])\\s*\\(`,
  "g"
);

// OpenCode runs every Copilot tool call as JavaScript inside its own `execute` tool, so its input is only code.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export function readOpencodeCopilotTools(rawInput: unknown): CopilotToolUse | null {
  const code = (rawInput as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== "string") return null;
  const calls: CopilotToolCall[] = Array.from(code.matchAll(CODE_COPILOT_TOOL_CALL), (match) => ({
    name: match[1] ?? match[2],
    code: code.slice(match.index),
  }));
  if (calls.length === 0) return null;
  // An approval of `execute` covers every tool or `fetch` its code reaches, even through an alias of `tools`, so only
  // code that names `tools` or `fetch` once, in a direct Copilot tool call, is said to run that tool.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/872
  const runs = code.match(CODE_EXTERNAL_ACCESS)?.length === 1 ? calls[0].name : null;
  return { runs, calls };
}
