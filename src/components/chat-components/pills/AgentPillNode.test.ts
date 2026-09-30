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
      it("contributes empty text content so the backend id never reaches the prompt", () => {
        const editor = makeEditor();
        editor.update(
          () => {
            const node = $createAgentPillNode("claude", "Claude");
            expect(node.getTextContent()).toBe("");
            expect(node.getBackendId()).toBe("claude");
          },
          { discrete: true }
        );
      });
    });
  });
});
