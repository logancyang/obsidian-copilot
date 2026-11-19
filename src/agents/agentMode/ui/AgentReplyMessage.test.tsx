import type { AgentMention } from "@/agents/agentMentions";
import { AgentReplyMessage } from "@/agents/agentMode/ui/AgentReplyMessage";
import { ChatAgentsContext, ChatRunsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const MAYA_MARKER = { agent: "maya", name: "Maya", mention: "m1" };
const LEO_MARKER = { agent: "leo", name: "Leo", mention: "m2" };
const REPLY = "**Six features** in 90 seconds is too many.";

const CHANGE = {
  path: "Plans/Launch plan.md",
  status: "modified" as const,
  before: "a\n",
  after: "a\nb\n",
  additions: 1,
  deletions: 0,
};

function leoRun(change: Partial<AgentMention>): AgentMention {
  return { id: "m2", agent: "leo", name: "Leo", status: "working", startedAt: 0, ...change };
}

function renderInChat(element: React.ReactElement, openRun = jest.fn()) {
  return render(
    <AppContext.Provider value={{} as App}>
      <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco", openRun }}>
        <ChatRunsContext.Provider value={() => true}>{element}</ChatRunsContext.Provider>
      </ChatAgentsContext.Provider>
    </AppContext.Provider>
  );
}

describe("AgentReplyMessage", () => {
  describe("AgentReplyMessage()", () => {
    it(`reads "Message from (face) Maya" with none of her words in the chat (${CARDS})`, () => {
      const { container } = renderInChat(
        <AgentReplyMessage marker={MAYA_MARKER} reply={REPLY} onOpenFileChange={jest.fn()} />
      );

      expect(screen.getByRole("button").textContent).toBe("Message fromMaya");
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBeNull();
      expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
      expect(container.textContent).not.toContain("Six features");
    });

    it(`opens the conversation of the run the reply came from (${CARDS})`, () => {
      const openRun = jest.fn();
      renderInChat(
        <AgentReplyMessage marker={LEO_MARKER} reply={REPLY} onOpenFileChange={jest.fn()} />,
        openRun
      );

      fireEvent.click(screen.getByRole("button", { name: "Open Coco's conversation with Leo" }));

      expect(openRun).toHaveBeenCalledWith({ runId: "m2" });
    });

    it(`reads the agent's question as a message from it too (${CARDS})`, () => {
      const { container } = renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="Should the three Stripe payouts count in October or November?"
          run={leoRun({ status: "question" })}
          onOpenFileChange={jest.fn()}
        />
      );

      expect(screen.getByRole("button").textContent).toBe("Message fromLeo");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(LEO.faceSrc);
    });

    it.each([
      [{ status: "stopped" }, "Leostopped"],
      [{ status: "didnt_finish" }, "Leodidn't finish"],
    ] as const)(
      `says how a run that relayed no words ended, on the same card (${CARDS})`,
      (change, label) => {
        renderInChat(
          <AgentReplyMessage
            marker={LEO_MARKER}
            reply=""
            run={leoRun(change)}
            onOpenFileChange={jest.fn()}
          />
        );

        expect(screen.getByRole("button").textContent).toBe(label);
      }
    );

    it(`reads a stopped run's last words as a message from it (${CARDS})`, () => {
      renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="Matched 182 of 214 before you stopped me."
          run={leoRun({ status: "stopped" })}
          onOpenFileChange={jest.fn()}
        />
      );

      expect(screen.getByRole("button").textContent).toBe("Message fromLeo");
    });

    it(`shows the files the agent changed under the card, each opening its diff (${CARDS})`, () => {
      const onOpenFileChange = jest.fn();
      renderInChat(
        <AgentReplyMessage
          marker={MAYA_MARKER}
          reply="Added the line."
          fileChanges={[CHANGE]}
          onOpenFileChange={onOpenFileChange}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Plans/Launch plan.md" }));

      expect(onOpenFileChange).toHaveBeenCalledWith(CHANGE);
    });

    it("names an agent the chat no longer lists from the reply itself", () => {
      const { container } = render(
        <AgentReplyMessage marker={MAYA_MARKER} reply={REPLY} onOpenFileChange={jest.fn()} />
      );

      expect(container.textContent).toBe("Message fromMaya");
      expect(container.querySelector("img")).toBeNull();
    });
  });
});
