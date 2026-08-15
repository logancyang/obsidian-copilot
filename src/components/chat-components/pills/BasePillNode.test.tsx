import React from "react";
import { createEditor, type EditorConfig, type LexicalEditor } from "lexical";
import { BasePillNode } from "./BasePillNode";

class TestPillNode extends BasePillNode {
  static getType(): string {
    return "test-pill";
  }

  static clone(node: TestPillNode): TestPillNode {
    return new TestPillNode(node.__value, node.__key);
  }

  getClassName(): string {
    return "test-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-test-pill";
  }

  decorate(): JSX.Element {
    return <span />;
  }
}

const TEST_EDITOR_CONFIG: EditorConfig = { namespace: "base-pill-test", theme: {} };

/** Builds an editor whose root element lives in the jsdom document. */
function makeEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: "base-pill-test",
    nodes: [TestPillNode],
    onError: (e) => {
      throw e;
    },
  });
  editor.setRootElement(document.body.createDiv());
  return editor;
}

describe("BasePillNode", () => {
  describe("createDOM()", () => {
    it("returns a detached span wearing the subclass's wrapper class", () => {
      const editor = makeEditor();
      editor.update(
        () => {
          const element = new TestPillNode("value").createDOM(TEST_EDITOR_CONFIG, editor);

          expect(element.tagName).toBe("SPAN");
          expect(element.className).toBe("test-pill-wrapper");
          // Lexical owns placement; handing it an already-attached node would
          // duplicate the pill in the composer.
          expect(element.parentNode).toBeNull();
        },
        { discrete: true }
      );
    });

    it("builds the span in the document that hosts the editor", () => {
      const editor = makeEditor();
      editor.update(
        () => {
          const element = new TestPillNode("value").createDOM(TEST_EDITOR_CONFIG, editor);

          expect(element.ownerDocument).toBe(editor.getRootElement()?.ownerDocument);
        },
        { discrete: true }
      );
    });
  });

  describe("exportDOM()", () => {
    it("marks the span with the pill attribute, its value, and the value as text", () => {
      const editor = makeEditor();
      editor.update(
        () => {
          const { element } = new TestPillNode("some value").exportDOM(editor);

          expect((element as HTMLElement).getAttribute("data-lexical-test-pill")).toBe("");
          expect((element as HTMLElement).getAttribute("data-pill-value")).toBe("some value");
          expect(element?.textContent).toBe("some value");
          expect(element?.parentNode).toBeNull();
        },
        { discrete: true }
      );
    });
  });
});
