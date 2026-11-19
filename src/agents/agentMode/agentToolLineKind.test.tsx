import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { agentToolLineKind } from "@/agents/agentMode/agentToolLineKind";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { render } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";

const ASK_CALL: ToolCallPart = {
  kind: "tool_call",
  id: "call-1",
  title: ASK_AGENT_TOOL_NAME,
  status: "completed",
  mcpServer: "obsidian-copilot",
  vendorToolName: ASK_AGENT_TOOL_NAME,
  input: { agent: "Maya", message: SENT },
  copilotTools: directCopilotToolUse("obsidian-copilot", ASK_AGENT_TOOL_NAME, {
    agent: "Maya",
    message: SENT,
  }),
};

describe("agentToolLineKind", () => {
  describe("agentToolLineKind", () => {
    describe("place()", () => {
      it(`gives an @ tool call a line of its own (${ISSUE})`, () => {
        expect(agentToolLineKind.place(ASK_CALL, { tasks: null })).toEqual({ joinKey: null });
      });

      it("leaves Copilot's other tools to their own rows", () => {
        expect(
          agentToolLineKind.place({ ...ASK_CALL, copilotTools: undefined }, { tasks: null })
        ).toBeNull();
      });
    });

    describe("render()", () => {
      it("draws the call as its line", () => {
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

        expect(container.textContent).toBe(`Asked Maya· ${SENT}`);
      });
    });
  });
});
