import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import { ChatAgentsContext, ChatRunsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const ASK: AgentToolCall = { tool: "ask_teammate", agent: "maya" };
const UNNAMED_ASK: AgentToolCall = { tool: "ask_teammate", agent: null };
const ORDINARY = <div>obsidian-copilot · Ask teammate</div>;

function part(status: ToolCallPart["status"] = "completed"): ToolCallPart {
  return { kind: "tool_call", id: "call-1", title: "ask_teammate", status };
}

function line(call: AgentToolCall, status?: ToolCallPart["status"]) {
  return <AgentToolLine call={call} part={part(status)} ordinaryRow={ORDINARY} />;
}

function inChat(element: React.ReactElement, openRun = jest.fn()) {
  return (
    <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco", openRun }}>
      <ChatRunsContext.Provider value={() => true}>{element}</ChatRunsContext.Provider>
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
      render(inChat(line({ tool: "ask_teammate", agent: "Leo" }), openRun));

      fireEvent.click(screen.getByRole("button", { name: "Open Coco's conversation with Leo" }));

      expect(openRun).toHaveBeenCalledWith({ callId: "call-1", agent: LEO.slug });
    });

    it(`reads "Asking …" with a blank face and nothing to open, never the tool's name, while the running call names no agent yet (${CARDS})`, () => {
      const { container } = render(inChat(line(UNNAMED_ASK, "in_progress")));

      expect(container.textContent).toBe("Asking…");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(NEUTRAL_FACE_SRC);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it(`fills in the face and name in the same card once the call names the agent (${CARDS})`, () => {
      const { container, rerender } = render(inChat(line(UNNAMED_ASK, "in_progress")));
      const header = container.querySelector("[data-agent-activity-card-header]");

      rerender(inChat(line({ tool: "ask_teammate", agent: "Leo" }, "in_progress")));

      expect(container.querySelector("[data-agent-activity-card-header]")).toBe(header);
      expect(header?.textContent).toBe("AskingLeo…");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(LEO.faceSrc);
    });

    it(`names the agent in a line of its own, with nothing to open, for the tools that send no message (${ISSUE})`, () => {
      const { container } = render(inChat(line({ tool: "check_teammate", agent: "Maya" })));

      expect(container.textContent).toBe("Checked Maya's progress");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("finds the agent whatever case the call wrote its name in", () => {
      const { container } = render(inChat(line({ tool: "stop_teammate", agent: "leo" })));

      expect(container.textContent).toBe("Stopped Leo");
    });

    it.each([
      ["an agent the vault doesn't have", "Nora"],
      ["the chat's own agent", "Coco"],
    ])(
      `keeps the ordinary row for a call naming %s, which the agent turned down (${ISSUE})`,
      (_case, agent) => {
        const { container } = render(inChat(line({ tool: "stop_teammate", agent })));

        expect(container.textContent).toBe("obsidian-copilot · Ask teammate");
      }
    );

    it(`holds "Asking …" with a blank face while an ask naming an agent the vault doesn't have runs, and shows the ordinary row only once it ends (${CARDS})`, () => {
      const nora: AgentToolCall = { tool: "ask_teammate", agent: "Nora" };
      const { container, rerender } = render(inChat(line(nora, "in_progress")));

      expect(container.textContent).toBe("Asking…");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(NEUTRAL_FACE_SRC);

      rerender(inChat(line(nora, "completed")));

      expect(container.textContent).toBe("obsidian-copilot · Ask teammate");
    });

    it(`keeps the call's ordinary row where the chat lists no agents, as without custom agents (${ISSUE})`, () => {
      const { container } = render(line(ASK));

      expect(container.textContent).toBe("obsidian-copilot · Ask teammate");
    });
  });
});
