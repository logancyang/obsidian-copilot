import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-markdown">{text}</div>,
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";
const ASK = { tool: "ask_agent", agent: "maya", message: SENT };
const ORDINARY = <div>obsidian-copilot · Ask agent</div>;

function line(call: typeof ASK | { tool: string; agent: string; message: null }, open = false) {
  return (
    <AgentToolLine
      call={call}
      app={{} as App}
      open={open}
      onToggle={jest.fn()}
      ordinaryRow={ORDINARY}
    />
  );
}

function inChat(element: React.ReactElement) {
  return (
    <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco" }}>
      {element}
    </ChatAgentsContext.Provider>
  );
}

describe("AgentToolLine", () => {
  describe("AgentToolLine()", () => {
    it(`shows the asked agent's face and the message sent, which opens in full (${ISSUE})`, () => {
      const { container, rerender } = render(inChat(line(ASK)));

      expect(screen.getByRole("button").textContent).toBe(`Asked Maya· ${SENT}`);
      expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
      expect(screen.queryByTestId("agent-markdown")).toBeNull();

      rerender(inChat(line(ASK, true)));

      expect(screen.getByTestId("agent-markdown").textContent).toBe(SENT);
    });

    it(`names the agent in a line of its own for the tools that send no message (${ISSUE})`, () => {
      const { container } = render(
        inChat(line({ tool: "check_agent", agent: "Maya", message: null }))
      );

      expect(container.textContent).toBe("Checked Maya's progress");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("finds the agent whatever case the call wrote its name in", () => {
      const { container } = render(
        inChat(line({ tool: "stop_agent", agent: "leo", message: null }))
      );

      expect(container.textContent).toBe("Stopped Leo");
    });

    it.each([
      ["an agent the vault doesn't have", "Nora"],
      ["the chat's own agent", "Coco"],
    ])(
      `keeps the ordinary row for a call naming %s, which the agent turned down (${ISSUE})`,
      (_case, agent) => {
        const { container } = render(inChat(line({ tool: "stop_agent", agent, message: null })));

        expect(container.textContent).toBe("obsidian-copilot · Ask agent");
      }
    );

    it(`keeps the call's ordinary row where the chat lists no agents, as without custom agents (${ISSUE})`, () => {
      const { container } = render(line(ASK));

      expect(container.textContent).toBe("obsidian-copilot · Ask agent");
    });
  });
});
