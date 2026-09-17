import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from "lexical";
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
  it("contributes empty text content so the agent slug never reaches the prompt", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createAgentPillNode("jennifer", "Jennifer", "🪶");
        expect(node.getTextContent()).toBe("");
        // The slug is still available structurally for routing.
        expect(node.getAgentSlug()).toBe("jennifer");
      },
      { discrete: true }
    );
  });

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

  it("serializes a prompt with an agent pill + text without leaking the agent slug", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createAgentPillNode("jennifer", "Jennifer", "🪶"));
        paragraph.append($createTextNode(" should we use X?"));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    const promptText = editor.getEditorState().read(() => $getRoot().getTextContent());
    expect(promptText).toBe(" should we use X?");
    expect(promptText).not.toContain("jennifer");
  });
});
