import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { CopilotToolCall, CopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import jsTokens, { type Token } from "js-tokens";

const CODE_COPILOT_TOOL_CALL = new RegExp(
  `^tools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\](?:\\.(\\w+)|\\[["']([\\w-]+)["']\\])\\(`
);
const CODE_TRIVIA = new Set([
  "WhiteSpace",
  "LineTerminatorSequence",
  "SingleLineComment",
  "MultiLineComment",
  "HashbangComment",
]);

interface SourceToken {
  type: Token["type"];
  value: string;
  start: number;
}

// Tool examples inside strings and comments must not create phantom calls or hide real ones.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/875
export function readOpencodeCopilotTools(rawInput: unknown): CopilotToolUse | null {
  const code = (rawInput as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== "string") return null;
  const tokens: SourceToken[] = [];
  let start = 0;
  for (const token of jsTokens(code)) {
    if (token.type === "Invalid" || ("closed" in token && !token.closed)) return null;
    if (!CODE_TRIVIA.has(token.type)) tokens.push({ ...token, start });
    start += token.value.length;
  }
  const calls: CopilotToolCall[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "IdentifierName" || token.value !== "tools") continue;
    if (tokens[index - 1]?.value === "." || tokens[index - 1]?.value === "?.") continue;
    const member = tokens
      .slice(index, index + 8)
      .map((part) => part.value)
      .join("");
    const match = CODE_COPILOT_TOOL_CALL.exec(member);
    if (match) calls.push({ name: match[1] ?? match[2], code: code.slice(token.start) });
  }
  return calls.length > 0 ? { wrapper: "Execute", calls } : null;
}
