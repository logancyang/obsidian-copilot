import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const ASK: AgentToolCall = { tool: "ask_agent", agent: "maya" };
const ORDINARY = <div>obsidian-copilot · Ask agent</div>;

function part(status: ToolCallPart["status"] = "completed"): ToolCallPart {
  return { kind: "tool_call", id: "call-1", title: "ask_agent", status };
}

function line(call: AgentToolCall, status?: ToolCallPart["status"]) {
  return <AgentToolLine call={call} part={part(status)} ordinaryRow={ORDINARY} />;
}

function inChat(element: React.ReactElement, openRun = jest.fn()) {
  return (
    <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco", openRun }}>
      {element}
    </ChatAgentsContext.Provider>
  );
}

describe("AgentToolLine", () => {
  describe("AgentToolLine()", () => {
    it.each(["pending", "in_progress"] as const)(
      `reads "Asking (face) Maya …" while the ask is %s, with no message text and nothing to expand (${CARDS})`,
      (status) => {
        const { container } = render(inChat(line(ASK, status)));

        expect(screen.getByRole("button").textContent).toBe("AskingMaya…");
        expect(screen.getByRole("button").getAttribute("aria-expanded")).toBeNull();
        expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
      }
    );

    it(`reads "Messaged (face) Maya" once the ask completed, as a reopened chat's ask does (${CARDS})`, () => {
      render(inChat(line(ASK)));

      expect(screen.getByRole("button").textContent).toBe("MessagedMaya");
    });

    it(`opens the conversation the ask started, found by the call and the asked agent (${CARDS})`, () => {
      const openRun = jest.fn();
      render(inChat(line({ tool: "ask_agent", agent: "Leo" }), openRun));

      fireEvent.click(screen.getByRole("button", { name: "Open Coco's conversation with Leo" }));

      expect(openRun).toHaveBeenCalledWith({ callId: "call-1", agent: LEO.slug });
    });

    it(`names the agent in a line of its own, with nothing to open, for the tools that send no message (${ISSUE})`, () => {
      const { container } = render(inChat(line({ tool: "check_agent", agent: "Maya" })));

      expect(container.textContent).toBe("Checked Maya's progress");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("finds the agent whatever case the call wrote its name in", () => {
      const { container } = render(inChat(line({ tool: "stop_agent", agent: "leo" })));

      expect(container.textContent).toBe("Stopped Leo");
    });

    it.each([
      ["an agent the vault doesn't have", "Nora"],
      ["the chat's own agent", "Coco"],
    ])(
      `keeps the ordinary row for a call naming %s, which the agent turned down (${ISSUE})`,
      (_case, agent) => {
        const { container } = render(inChat(line({ tool: "stop_agent", agent })));

        expect(container.textContent).toBe("obsidian-copilot · Ask agent");
      }
    );

    it(`keeps the call's ordinary row where the chat lists no agents, as without custom agents (${ISSUE})`, () => {
      const { container } = render(line(ASK));

      expect(container.textContent).toBe("obsidian-copilot · Ask agent");
    });
  });
});
