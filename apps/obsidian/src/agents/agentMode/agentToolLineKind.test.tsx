import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { foldActivityGroups } from "@/agentMode/ui/activityGroups";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { CHECK_AGENT_TOOL_NAME } from "@/agents/agentMode/agentToolCalls";
import { agentToolLineKind } from "@/agents/agentMode/agentToolLineKind";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { render } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";

const ASK_CALL: ToolCallPart = {
  kind: "tool_call",
  id: "call-1",
  title: ASK_AGENT_TOOL_NAME,
  status: "completed",
  mcpServer: "obsidian-copilot",
  vendorToolName: ASK_AGENT_TOOL_NAME,
  input: { teammate: "Maya", message: SENT },
  copilotTools: directCopilotToolUse("obsidian-copilot", ASK_AGENT_TOOL_NAME, {
    teammate: "Maya",
    message: SENT,
  }),
};

function askCall(id: string, agent: string): ToolCallPart {
  return {
    ...ASK_CALL,
    id,
    input: { teammate: agent, message: SENT },
    copilotTools: directCopilotToolUse("obsidian-copilot", ASK_AGENT_TOOL_NAME, {
      teammate: agent,
      message: SENT,
    }),
  };
}

const CHECK_CALL: ToolCallPart = {
  ...ASK_CALL,
  id: "call-check",
  title: CHECK_AGENT_TOOL_NAME,
  vendorToolName: CHECK_AGENT_TOOL_NAME,
  input: { teammate: "Leo" },
  copilotTools: directCopilotToolUse("obsidian-copilot", CHECK_AGENT_TOOL_NAME, {
    teammate: "Leo",
  }),
};

describe("agentToolLineKind", () => {
  describe("agentToolLineKind", () => {
    describe("place()", () => {
      it(`gives an @ tool call other than asking a line of its own (${ISSUE})`, () => {
        expect(agentToolLineKind.place(CHECK_CALL, { tasks: null })).toEqual({ joinKey: null });
      });

      it(`gives each ask a card of its own in call order, as when one message mentions several agents (${CARDS})`, () => {
        const trail = foldActivityGroups(
          [askCall("ask-maya", "Maya"), askCall("ask-leo", "Leo"), CHECK_CALL].map((part) => ({
            type: "action" as const,
            part,
          })),
          { tasks: null },
          [agentToolLineKind]
        );

        expect(
          trail.map((node) => (node.type === "toolCard" ? node.members.map(({ id }) => id) : node))
        ).toEqual([["ask-maya"], ["ask-leo"], ["call-check"]]);
      });

      it(`leaves a failed ask, which asked nobody, on its ordinary row with its error (${ISSUE})`, () => {
        expect(
          agentToolLineKind.place({ ...ASK_CALL, status: "failed" }, { tasks: null })
        ).toBeNull();
      });

      it("leaves Copilot's other tools to their own rows", () => {
        expect(
          agentToolLineKind.place({ ...ASK_CALL, copilotTools: undefined }, { tasks: null })
        ).toBeNull();
      });
    });

    describe("render()", () => {
      it(`draws the ask as its card naming the asked agent (${CARDS})`, () => {
        const { container } = render(
          <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco" }}>
            <>
              {agentToolLineKind.render([ASK_CALL], {
                tasks: null,
                app: {} as App,
                open: false,
                onToggle: jest.fn(),
                renderCall: () => "ordinary row",
              })}
            </>
          </ChatAgentsContext.Provider>
        );

        expect(container.textContent).toBe("MessagedMaya");
      });
    });
  });
});
