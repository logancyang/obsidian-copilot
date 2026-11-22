import { renderAgentMentions, useAgentMentionRenderer } from "@/agents/ui/agentMentionPills";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { renderHook } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

function rendered(text: string, tag = "p"): HTMLElement {
  const container = document.createElement("div");
  const element = document.createElement(tag);
  element.textContent = text;
  container.appendChild(element);
  document.body.appendChild(container);
  return container;
}

const pills = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("span")).map((span) => ({
    text: span.textContent,
    face: span.querySelector("img")?.getAttribute("src"),
  }));

describe("agentMentionPills", () => {
  describe("renderAgentMentions()", () => {
    it(`draws each mentioned agent as a pill with its face and keeps the rest of the text (${ISSUE})`, () => {
      const container = rendered("@Maya and @Leo, does the budget hold?");

      renderAgentMentions(container, [
        { name: "Maya", agent: MAYA },
        { name: "Leo", agent: LEO },
      ]);

      expect(pills(container)).toEqual([
        { text: "Maya", face: MAYA.faceSrc },
        { text: "Leo", face: LEO.faceSrc },
      ]);
      expect(container.textContent).toBe("Maya and Leo, does the budget hold?");
    });

    it("keeps a mention inside code as typed", () => {
      const container = rendered("@Maya", "code");

      renderAgentMentions(container, [{ name: "Maya", agent: MAYA }]);

      expect(pills(container)).toEqual([]);
    });
  });

  describe("useAgentMentionRenderer()", () => {
    it("draws the message's mentioned agents that the chat still lists", () => {
      const { result } = renderHook(() => useAgentMentionRenderer(["Maya", "Gone"]), {
        wrapper: ({ children }) => (
          <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: null }}>
            {children}
          </ChatAgentsContext.Provider>
        ),
      });
      const container = rendered("@Maya and @Gone");

      result.current(container);

      expect(pills(container)).toEqual([{ text: "Maya", face: MAYA.faceSrc }]);
      expect(container.textContent).toBe("Maya and @Gone");
    });

    it(`leaves the text as typed where the chat lists no agents, as without custom agents (${ISSUE})`, () => {
      const { result } = renderHook(() => useAgentMentionRenderer(["Maya"]));
      const container = rendered("@Maya is this too long?");

      result.current(container);

      expect(container.innerHTML).toBe("<p>@Maya is this too long?</p>");
    });
  });
});
