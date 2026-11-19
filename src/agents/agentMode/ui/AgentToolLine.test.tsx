import type { AgentToolCall } from "@/agents/agentMode/agentToolCalls";
import { AgentToolLine } from "@/agents/agentMode/ui/AgentToolLine";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, NORA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-markdown">{text}</div>,
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SEVERAL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/949";
const SENT = "Zero wants a blunt read of [[Launch video plan]]: six features in 90 seconds.";
const ASK: AgentToolCall = { tool: "ask_agent", agent: "maya", message: SENT };
const ASK_LEO: AgentToolCall = { tool: "ask_agent", agent: "Leo", message: "Check the numbers." };
const ORDINARY = <div>obsidian-copilot · Ask agent</div>;

function line(call: AgentToolCall | AgentToolCall[], open = false) {
  return (
    <AgentToolLine
      calls={Array.isArray(call) ? call : [call]}
      app={{} as App}
      open={open}
      onToggle={jest.fn()}
      ordinaryRow={ORDINARY}
    />
  );
}

function inChat(element: React.ReactElement, agents = THREE_AGENTS) {
  return (
    <ChatAgentsContext.Provider value={{ agents, self: "coco" }}>
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

    it(`names every agent asked one after another in one line with their faces, and opens to each message under its agent's name (${SEVERAL})`, () => {
      const { container, rerender } = render(inChat(line([ASK, ASK_LEO])));

      expect(screen.getByRole("button").textContent).toBe(`Asked Maya and Leo· ${SENT}`);
      expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
        MAYA.faceSrc,
        LEO.faceSrc,
      ]);

      rerender(inChat(line([ASK, ASK_LEO], true)));

      expect(screen.getByRole("button").nextElementSibling?.textContent).toBe(
        `Maya${SENT}LeoCheck the numbers.`
      );
    });

    it(`lists three agents asked together with commas and a final "and" (${SEVERAL})`, () => {
      const askNora: AgentToolCall = { tool: "ask_agent", agent: "Nora", message: SENT };

      const { container } = render(inChat(line([ASK, ASK_LEO, askNora]), [...THREE_AGENTS, NORA]));

      expect(container.querySelector("[role=button]")?.textContent).toBe(
        `Asked Maya, Leo and Nora· ${SENT}`
      );
    });

    it(`names an agent asked twice in a row once (${SEVERAL})`, () => {
      render(inChat(line([ASK, { ...ASK, message: "And the intro?" }])));

      expect(screen.getByRole("button").textContent).toBe(`Asked Maya· ${SENT}`);
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
