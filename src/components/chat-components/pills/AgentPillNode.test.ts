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
  it("contributes empty text content so the backend id never reaches the prompt", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createAgentPillNode("claude", "Claude");
        expect(node.getTextContent()).toBe("");
        // The id is still available structurally for routing.
        expect(node.getBackendId()).toBe("claude");
      },
      { discrete: true }
    );
  });

  it("serializes a prompt with an agent pill + text without leaking the backend id", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createAgentPillNode("claude", "Claude"));
        paragraph.append($createTextNode(" should we use X?"));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    const promptText = editor.getEditorState().read(() => $getRoot().getTextContent());
    expect(promptText).toBe(" should we use X?");
    expect(promptText).not.toContain("claude");
  });
});
