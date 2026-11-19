import { AgentMessageCard } from "@/agents/agentMode/ui/AgentMessageCard";
import { ChatAgentsContext, type ChatAgents } from "@/agents/ui/chatAgents";
import { LEO, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const RUN = { runId: "run-1" };

function inChat(element: React.ReactElement, chat: Partial<ChatAgents> = {}) {
  return (
    <ChatAgentsContext.Provider
      value={{ agents: THREE_AGENTS, self: "coco", openRun: jest.fn(), ...chat }}
    >
      {element}
    </ChatAgentsContext.Provider>
  );
}

describe("AgentMessageCard", () => {
  describe("AgentMessageCard()", () => {
    it(`reads its label, then the agent's face and name, with the name in the normal text color (${ISSUE})`, () => {
      const { container } = render(
        inChat(<AgentMessageCard before="Messaged" name="Leo" faceSrc={LEO.faceSrc} run={RUN} />)
      );

      expect(screen.getByRole("button").textContent).toBe("MessagedLeo");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(LEO.faceSrc);
      expect(screen.getByText("Leo").className).toContain("tw-text-normal");
      expect(screen.getByText("Messaged").className).not.toContain("tw-text-normal");
    });

    it(`reads the name first for a label that comes after it, as "Leo stopped" (${ISSUE})`, () => {
      render(inChat(<AgentMessageCard name="Leo" after="stopped" run={RUN} />));

      expect(screen.getByRole("button").textContent).toBe("Leostopped");
    });

    it(`opens the conversation of the run it names, as a button named for both agents (${ISSUE})`, () => {
      const openRun = jest.fn();
      render(inChat(<AgentMessageCard before="Messaged" name="Leo" run={RUN} />, { openRun }));

      fireEvent.click(screen.getByRole("button", { name: "Open Coco's conversation with Leo" }));

      expect(openRun).toHaveBeenCalledWith(RUN);
    });

    it(`names Copilot as the asking side in a chat without an agent (${ISSUE})`, () => {
      render(inChat(<AgentMessageCard before="Messaged" name="Leo" run={RUN} />, { self: null }));

      expect(
        screen.getByRole("button", { name: "Open Copilot's conversation with Leo" })
      ).toBeTruthy();
    });
  });
});
