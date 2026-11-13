import { FolderPillNode } from "@/components/chat-components/pills/FolderPillNode";
import { ChatInputProvider, useChatInput } from "@/context/ChatInputContext";
import { act, render } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from "lexical";
import React, { useEffect } from "react";

let requestFocus: () => void;

function Composer({ onFocus }: { onFocus: () => void }) {
  const { registerFocusHandler } = useChatInput();
  useEffect(() => {
    registerFocusHandler(onFocus);
    return () => registerFocusHandler(null);
  }, [registerFocusHandler, onFocus]);
  return null;
}

function FocusRequester() {
  requestFocus = useChatInput().focusInput;
  return null;
}

function renderComposer(onFocus: () => void) {
  return render(
    <ChatInputProvider>
      <FocusRequester />
      <Composer onFocus={onFocus} />
    </ChatInputProvider>
  );
}

function makeEditor(text: string, cursorOffset?: number): LexicalEditor {
  const editor = createEditor({ nodes: [FolderPillNode] });
  editor.update(
    () => {
      const textNode = $createTextNode(text);
      $getRoot().append($createParagraphNode().append(textNode));
      if (cursorOffset !== undefined) textNode.select(cursorOffset, cursorOffset);
    },
    { discrete: true }
  );
  return editor;
}

function EditorHost({ editor, folderPaths }: { editor: LexicalEditor; folderPaths: string[] }) {
  const { registerEditor, insertFolderPills } = useChatInput();
  useEffect(() => registerEditor(editor), [registerEditor, editor]);
  useEffect(() => insertFolderPills(folderPaths), [insertFolderPills, folderPaths]);
  return null;
}

function insertFolders(editor: LexicalEditor, folderPaths: string[]): Promise<string> {
  const text = new Promise<string>((resolve) => {
    editor.registerUpdateListener(({ editorState }) =>
      resolve(editorState.read(() => $getRoot().getTextContent()))
    );
  });
  render(
    <ChatInputProvider>
      <EditorHost editor={editor} folderPaths={folderPaths} />
    </ChatInputProvider>
  );
  return text;
}

describe("ChatInputContext", () => {
  describe("insertFolderPills()", () => {
    it("inserts one folder mention per path at the cursor, each followed by a space", async () => {
      const editor = makeEditor("Compare with last year", "Compare ".length);

      const text = await insertFolders(editor, ["Research/Pricing", "Archive/2025/docs"]);

      expect(text).toBe("Compare {Research/Pricing} {Archive/2025/docs} with last year");
    });

    it("adds the mention at the end of the message when the message box has no cursor (https://github.com/logancyang/obsidian-copilot/issues/3858)", async () => {
      const editor = makeEditor("Summarize");

      const text = await insertFolders(editor, ["Research/Pricing"]);

      expect(text).toBe("Summarize{Research/Pricing} ");
    });
  });

  describe("focusInput()", () => {
    it("focuses the registered composer", () => {
      const focus = jest.fn();
      renderComposer(focus);

      act(() => requestFocus());

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("waits for the next composer when the previous one was unregistered https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const previous = jest.fn();
      const next = jest.fn();
      const view = renderComposer(previous);
      const requestFromBeforeUnmount = requestFocus;
      view.rerender(
        <ChatInputProvider>
          <FocusRequester />
        </ChatInputProvider>
      );

      act(() => requestFromBeforeUnmount());
      expect(previous).not.toHaveBeenCalled();

      view.rerender(
        <ChatInputProvider>
          <FocusRequester />
          <Composer onFocus={next} />
        </ChatInputProvider>
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(previous).not.toHaveBeenCalled();
    });
  });
});
