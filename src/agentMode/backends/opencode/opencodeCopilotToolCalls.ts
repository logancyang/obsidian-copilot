import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { CopilotToolCallReader } from "@/agentMode/session/copilotToolCalls";
import type { AgentMessagePart } from "@/agentMode/session/types";

const CODE_EXTERNAL_ACCESS = /\b(?:tools|fetch)\b/g;
const CODE_COPILOT_TOOL_CALL = new RegExp(
  `\\btools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\](?:\\.(\\w+)|\\[["']([\\w-]+)["']\\])\\s*\\(`
);

function executeCode(part: Extract<AgentMessagePart, { kind: "tool_call" }>): string {
  const code = (part.input as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "";
}

// OpenCode runs every Copilot tool call as JavaScript inside its own `execute` tool, so its input is only code.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export const opencodeCopilotToolCalls: CopilotToolCallReader = {
  call(part, toolName) {
    const code = executeCode(part);
    const call = new RegExp(`tools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\]\\.${toolName}\\(`).exec(
      code
    );
    return call ? { code: code.slice(call.index) } : null;
  },
  // An approval of `execute` covers every tool or `fetch` its code reaches, even through an alias of `tools`, so only
  // code that names `tools` or `fetch` once, in a direct Copilot tool call, is named after that tool.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/872
  toolName(part) {
    const code = executeCode(part);
    if (code.match(CODE_EXTERNAL_ACCESS)?.length !== 1) return null;
    const call = CODE_COPILOT_TOOL_CALL.exec(code);
    return call ? (call[1] ?? call[2]) : null;
  },
};
