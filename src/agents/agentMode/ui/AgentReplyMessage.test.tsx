import type { AgentMention } from "@/agents/agentMentions";
import { AgentReplyMessage } from "@/agents/agentMode/ui/AgentReplyMessage";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-markdown">{text}</div>,
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const MAYA_MARKER = { agent: "maya", name: "Maya", mention: "m1" };
const LEO_MARKER = { agent: "leo", name: "Leo", mention: "m2" };
const REPLY = "**Six features** in 90 seconds is too many.\n\n```\nintro = 8s\n```";

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

function renderInChat(element: React.ReactElement) {
  return render(
    <AppContext.Provider value={{} as App}>
      <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: "coco" }}>
        {element}
      </ChatAgentsContext.Provider>
    </AppContext.Provider>
  );
}

describe("AgentReplyMessage", () => {
  describe("AgentReplyMessage()", () => {
    it(`folds the agent's own words under its face and name, opening them as markdown (${ISSUE})`, () => {
      const { container } = renderInChat(
        <AgentReplyMessage marker={MAYA_MARKER} reply={REPLY} onOpenFileChange={jest.fn()} />
      );

      expect(screen.getByRole("button").textContent).toBe("Maya's reply");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
      expect(screen.queryByTestId("agent-markdown")).toBeNull();

      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByTestId("agent-markdown").textContent).toBe(REPLY);
    });

    it(`shows the files the agent changed below the fold, each opening its diff (${ISSUE})`, () => {
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

    it(`says the agent didn't reply when its reply has no text, with nothing to open (${ISSUE})`, () => {
      renderInChat(
        <AgentReplyMessage marker={MAYA_MARKER} reply="" onOpenFileChange={jest.fn()} />
      );

      expect(screen.getByText("Maya didn't reply")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it(`folds the agent's question while its run waits on it (${ISSUE})`, () => {
      const { container } = renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="Should the three Stripe payouts count in October or November?"
          run={leoRun({ status: "question" })}
          onOpenFileChange={jest.fn()}
        />
      );

      expect(screen.getByRole("button").textContent).toBe("Leo's question");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(LEO.faceSrc);
    });

    it(`keeps an earlier relay of the same run folded as the question it was (${ISSUE})`, () => {
      renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="October or November?"
          run={leoRun({ status: "finished", endedAt: 1 })}
          followedUp
          onOpenFileChange={jest.fn()}
        />
      );

      expect(screen.getByRole("button").textContent).toBe("Leo's question");
    });

    it(`folds a relay as the question it was when its run ended with Obsidian closed, which relays nothing itself (${ISSUE})`, () => {
      renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="October or November?"
          run={leoRun({ status: "didnt_finish", end: { kind: "obsidian_closed" } })}
          onOpenFileChange={jest.fn()}
        />
      );

      expect(screen.getByRole("button").textContent).toBe("Leo's question");
    });

    it(`marks only the reply, not a question before it, as where See reply scrolls (${ISSUE})`, () => {
      const finished = leoRun({ status: "finished", endedAt: 1 });
      const { container } = renderInChat(
        <>
          <AgentReplyMessage
            marker={LEO_MARKER}
            reply="October or November?"
            run={finished}
            followedUp
            onOpenFileChange={jest.fn()}
          />
          <AgentReplyMessage
            marker={LEO_MARKER}
            reply="October reconciles."
            run={finished}
            onOpenFileChange={jest.fn()}
          />
        </>
      );

      expect(container.querySelector('[data-agent-relay="m2"]')?.textContent).toBe("Leo's reply");
    });

    it.each([
      [
        { kind: "error", message: "Leo's chat stopped before it finished." } as const,
        "Something went wrong: Leo's chat stopped before it finished.",
      ],
      [
        { kind: "permission_denied", requests: ["Edit October books.md"] } as const,
        "Copilot turned down a request: Edit October books.md",
      ],
    ])(`folds the reason an agent didn't finish with its words (${ISSUE})`, (end, reason) => {
      renderInChat(
        <AgentReplyMessage
          marker={LEO_MARKER}
          reply="I matched 182 of 214 transactions."
          run={leoRun({ status: "didnt_finish", end })}
          onOpenFileChange={jest.fn()}
        />
      );
      expect(screen.getByRole("button").textContent).toBe("Leo didn't finish");

      fireEvent.click(screen.getByRole("button"));

      expect(screen.getByText(reason)).toBeTruthy();
      expect(screen.getByTestId("agent-markdown").textContent).toBe(
        "I matched 182 of 214 transactions."
      );
    });

    it("names an agent the chat no longer lists from the reply itself", () => {
      const { container } = render(
        <AppContext.Provider value={{} as App}>
          <AgentReplyMessage marker={MAYA_MARKER} reply={REPLY} onOpenFileChange={jest.fn()} />
        </AppContext.Provider>
      );

      expect(screen.getByRole("button").textContent).toBe("Maya's reply");
      expect(container.querySelector("img")).toBeNull();
    });
  });
});
