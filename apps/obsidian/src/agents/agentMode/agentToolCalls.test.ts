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
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";

function claudeCall(
  tool: string,
  input: Record<string, unknown>,
  status: ToolCallPart["status"] = "completed"
): ToolCallPart {
  return {
    kind: "tool_call",
    id: "call-1",
    title: tool,
    status,
    mcpServer: "obsidian-copilot",
    vendorToolName: tool,
    input,
    copilotTools: directCopilotToolUse("obsidian-copilot", tool, input),
  };
}

const BACKENDS = [
  ["Claude", () => claudeCall(ASK_AGENT_TOOL_NAME, { teammate: "Maya", message: SENT })],
  [
    "Codex",
    (): ToolCallPart => {
      const input = {
        server: "obsidian-copilot",
        tool: ASK_AGENT_TOOL_NAME,
        arguments: { teammate: "Maya", message: SENT },
      };
      return {
        kind: "tool_call",
        id: "call-1",
        title: "mcp.obsidian-copilot.ask_teammate",
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
      title: "obsidian-copilot_ask_teammate",
      status: "completed",
      copilotTools:
        readOpencodeCopilotTools(
          { teammate: "Maya", message: SENT },
          "obsidian-copilot_ask_teammate"
        ) ?? undefined,
    }),
  ],
] as const;

describe("agentToolCalls", () => {
  describe("agentToolCall()", () => {
    it.each(BACKENDS)(
      `reads the asked agent from a %s ask_teammate call (${ISSUE})`,
      (_backend, call) => {
        expect(agentToolCall(call())).toEqual({ tool: ASK_AGENT_TOOL_NAME, agent: "Maya" });
      }
    );

    it("reads the agent from the other @ tools, without its @", () => {
      expect(agentToolCall(claudeCall(STOP_AGENT_TOOL_NAME, { teammate: "@Leo" }))).toEqual({
        tool: STOP_AGENT_TOOL_NAME,
        agent: "Leo",
      });
    });

    it("leaves Copilot's other tools, the agent draft among them, and a call without an agent to their own rows", () => {
      expect(agentToolCall(claudeCall("miyo_search", { teammate: "Maya" }))).toBeNull();
      expect(
        agentToolCall(
          claudeCall(DRAFT_AGENT_TOOL_NAME, { name: "Nora", instruction: "Plan pickups." })
        )
      ).toBeNull();
      expect(agentToolCall(claudeCall(ASK_AGENT_TOOL_NAME, { message: SENT }))).toBeNull();
    });

    it.each(["pending", "in_progress"] as const)(
      `keeps an ask that is %s as an ask whose agent isn't known yet, while the model still writes its arguments (${CARDS})`,
      (status) => {
        expect(agentToolCall(claudeCall(ASK_AGENT_TOOL_NAME, {}, status))).toEqual({
          tool: ASK_AGENT_TOOL_NAME,
          agent: null,
        });
      }
    );

    it(`leaves the other @ tools to their own rows until they name the agent (${CARDS})`, () => {
      expect(agentToolCall(claudeCall(CHECK_AGENT_TOOL_NAME, {}, "in_progress"))).toBeNull();
    });

    it(`leaves a call that failed to its ordinary row, since it did nothing with the agent (${ISSUE})`, () => {
      expect(
        agentToolCall({
          ...claudeCall(ASK_AGENT_TOOL_NAME, { teammate: "Nora", message: SENT }),
          status: "failed",
        })
      ).toBeNull();
    });
  });

  describe("agentToolLineText()", () => {
    it.each([
      [CHECK_AGENT_TOOL_NAME, "Checked Leo's progress"],
      [ANSWER_AGENT_TOOL_NAME, "Passed your answer to Leo"],
      [STOP_AGENT_TOOL_NAME, "Stopped Leo"],
    ])(`names what the chat's agent did with the agent for %s (${ISSUE})`, (tool, text) => {
      expect(agentToolLineText({ tool, agent: "leo" }, "Leo")).toBe(text);
    });
  });
});
