import { createEditor, type LexicalEditor } from "lexical";
import { $createAgentPillNode, AgentPillNode } from "./AgentPillNode";

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: "agent-pill-test",
    nodes: [AgentPillNode],
    onError: (e) => {
      throw e;
    },
  });
}

describe("AgentPillNode", () => {
  describe("AgentPillNode", () => {
    describe("getTextContent()", () => {
      it("contributes empty text content so the agent slug never reaches the prompt", () => {
        const editor = makeEditor();
        editor.update(
          () => {
            const node = $createAgentPillNode("jennifer", "Jennifer", "🪶");
            expect(node.getTextContent()).toBe("");
            expect(node.getAgentSlug()).toBe("jennifer");
          },
          { discrete: true }
        );
      });
    });

    describe("importJSON()", () => {
      it("round-trips the agent's name and icon through serialization, so render needs no roster", () => {
        const editor = makeEditor();
        editor.update(
          () => {
            const node = $createAgentPillNode("jennifer", "Jennifer", "🪶");
            const restored = AgentPillNode.importJSON(node.exportJSON());
            expect(restored.exportJSON()).toMatchObject({
              value: "jennifer",
              label: "Jennifer",
              icon: "🪶",
            });
          },
          { discrete: true }
        );
      });
    });
  });
});
