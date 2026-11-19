import { readCodexCopilotTools } from "@/agentMode/backends/codex/codexCopilotToolCalls";
import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";
import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import {
  agentToolCall,
  agentToolLineText,
  ANSWER_AGENT_TOOL_NAME,
  CHECK_AGENT_TOOL_NAME,
  STOP_AGENT_TOOL_NAME,
} from "@/agents/agentMode/agentToolCalls";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { DRAFT_AGENT_TOOL_NAME } from "@/agents/agentMode/draftAgentTool";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";

function claudeCall(tool: string, input: Record<string, unknown>): ToolCallPart {
  return {
    kind: "tool_call",
    id: "call-1",
    title: tool,
    status: "completed",
    mcpServer: "obsidian-copilot",
    vendorToolName: tool,
    input,
    copilotTools: directCopilotToolUse("obsidian-copilot", tool, input),
  };
}

const BACKENDS = [
  ["Claude", () => claudeCall(ASK_AGENT_TOOL_NAME, { agent: "Maya", message: SENT })],
  [
    "Codex",
    (): ToolCallPart => {
      const input = {
        server: "obsidian-copilot",
        tool: ASK_AGENT_TOOL_NAME,
        arguments: { agent: "Maya", message: SENT },
      };
      return {
        kind: "tool_call",
        id: "call-1",
        title: "mcp.obsidian-copilot.ask_agent",
        status: "completed",
        input,
        copilotTools: readCodexCopilotTools(input) ?? undefined,
      };
    },
  ],
  [
    "OpenCode",
    (): ToolCallPart => ({
      kind: "tool_call",
      id: "call-1",
      title: "obsidian-copilot_ask_agent",
      status: "completed",
      copilotTools:
        readOpencodeCopilotTools({ agent: "Maya", message: SENT }, "obsidian-copilot_ask_agent") ??
        undefined,
    }),
  ],
] as const;

describe("agentToolCalls", () => {
  describe("agentToolCall()", () => {
    it.each(BACKENDS)(
      `reads the asked agent and the message sent from a %s ask_agent call (${ISSUE})`,
      (_backend, call) => {
        expect(agentToolCall(call())).toEqual({
          tool: ASK_AGENT_TOOL_NAME,
          agent: "Maya",
          message: SENT,
        });
      }
    );

    it("reads only the agent from the other @ tools", () => {
      expect(agentToolCall(claudeCall(STOP_AGENT_TOOL_NAME, { agent: "@Leo" }))).toEqual({
        tool: STOP_AGENT_TOOL_NAME,
        agent: "Leo",
        message: null,
      });
    });

    it("leaves Copilot's other tools, the agent draft among them, and a call without an agent to their own rows", () => {
      expect(agentToolCall(claudeCall("miyo_search", { agent: "Maya" }))).toBeNull();
      expect(
        agentToolCall(
          claudeCall(DRAFT_AGENT_TOOL_NAME, { name: "Nora", instruction: "Plan pickups." })
        )
      ).toBeNull();
      expect(agentToolCall(claudeCall(ASK_AGENT_TOOL_NAME, { message: SENT }))).toBeNull();
    });

    it(`leaves a call that failed to its ordinary row, since it did nothing with the agent (${ISSUE})`, () => {
      expect(
        agentToolCall({
          ...claudeCall(ASK_AGENT_TOOL_NAME, { agent: "Nora", message: SENT }),
          status: "failed",
        })
      ).toBeNull();
    });
  });

  describe("agentToolLineText()", () => {
    it.each([
      [ASK_AGENT_TOOL_NAME, "Asked Leo"],
      [CHECK_AGENT_TOOL_NAME, "Checked Leo's progress"],
      [ANSWER_AGENT_TOOL_NAME, "Passed your answer to Leo"],
      [STOP_AGENT_TOOL_NAME, "Stopped Leo"],
    ])(`names what the chat's agent did with the agent for %s (${ISSUE})`, (tool, text) => {
      expect(agentToolLineText({ tool, agent: "leo", message: null }, "Leo")).toBe(text);
    });
  });
});
