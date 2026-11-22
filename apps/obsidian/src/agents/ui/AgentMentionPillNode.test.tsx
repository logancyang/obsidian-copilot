import {
  $createAgentMentionPillNode,
  $isAgentMentionPillNode,
  AgentMentionPillNode,
} from "@/agents/ui/AgentMentionPillNode";
import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { render } from "@testing-library/react";
import { createEditor, type LexicalEditor } from "lexical";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

function makeEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: "agent-pill-test",
    nodes: [AgentMentionPillNode],
    onError: (e) => {
      throw e;
    },
  });
  editor.setRootElement(document.body.createDiv());
  return editor;
}

function inEditor<T>(read: () => T): T {
  let value!: T;
  makeEditor().update(() => (value = read()), { discrete: true });
  return value;
}

describe("AgentMentionPillNode", () => {
  describe("AgentMentionPillNode", () => {
    describe("getTextContent()", () => {
      it(`writes the mention as @ and the agent's name, the text the message is sent with (${ISSUE})`, () => {
        expect(inEditor(() => $createAgentMentionPillNode("maya", "Maya").getTextContent())).toBe(
          "@Maya"
        );
      });
    });

    describe("exportDOM()", () => {
      it(`copies the pill as @ and the agent's name, not its folder name (${ISSUE})`, () => {
        const editor = makeEditor();
        let text: string | null = null;
        editor.update(
          () => {
            text =
              $createAgentMentionPillNode("maya-chen", "Maya Chen").exportDOM(editor).element
                ?.textContent ?? null;
          },
          { discrete: true }
        );

        expect(text).toBe("@Maya Chen");
      });
    });

    describe("exportJSON()", () => {
      it("keeps the agent's folder and name, so a saved draft restores the same pill", () => {
        const restored = inEditor(() =>
          AgentMentionPillNode.importJSON(
            $createAgentMentionPillNode("maya", "Maya").exportJSON()
          ).getTextContent()
        );

        expect(restored).toBe("@Maya");
      });
    });

    describe("decorate()", () => {
      it(`draws the pill with the agent's face and name (${ISSUE})`, () => {
        const pill = inEditor(() => $createAgentMentionPillNode("maya", "Maya").decorate());

        const { container } = render(
          <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self: null }}>
            {pill}
          </ChatAgentsContext.Provider>
        );

        expect(container.textContent).toBe("Maya");
        expect(container.querySelector("img")?.getAttribute("src")).toBe(MAYA.faceSrc);
      });

      it("draws the name alone once the agent is no longer listed", () => {
        const pill = inEditor(() => $createAgentMentionPillNode("maya", "Maya").decorate());

        const { container } = render(pill);

        expect(container.textContent).toBe("Maya");
        expect(container.querySelector("img")).toBeNull();
      });
    });
  });

  describe("$isAgentMentionPillNode()", () => {
    it("tells an agent pill from any other node", () => {
      expect(
        inEditor(() => $isAgentMentionPillNode($createAgentMentionPillNode("leo", "Leo")))
      ).toBe(true);
      expect($isAgentMentionPillNode(null)).toBe(false);
    });
  });
});
