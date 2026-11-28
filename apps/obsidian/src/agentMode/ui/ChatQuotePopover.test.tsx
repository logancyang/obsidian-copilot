import { ChatQuoteMenu, ChatQuotePopover } from "@/agentMode/ui/ChatQuotePopover";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function select(node: Node, start = 0, end = node.textContent?.length ?? 0): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function Transcript({ onAdd }: { onAdd: jest.Mock }) {
  const [chat, setChat] = React.useState<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={setChat} data-testid="chat">
        <p>Use Postgres for the index.</p>
        <div contentEditable suppressContentEditableWarning data-testid="composer">
          <p>My unsent draft.</p>
        </div>
      </div>
      <p data-testid="outside">A note in the editor.</p>
      <ChatQuotePopover scopeEl={chat} onAdd={onAdd} />
    </>
  );
}

function renderTranscript() {
  const onAdd = jest.fn();
  render(<Transcript onAdd={onAdd} />);
  return { chat: screen.getByTestId("chat"), onAdd };
}

describe("ChatQuotePopover", () => {
  const { getBoundingClientRect } = Range.prototype;
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 10,
        top: 10,
        left: 10,
        right: 90,
        bottom: 26,
        width: 80,
        height: 16,
      }) as DOMRect;
  });
  afterAll(() => {
    Range.prototype.getBoundingClientRect = getBoundingClientRect;
  });
  afterEach(() => document.getSelection()?.removeAllRanges());

  describe("ChatQuoteMenu()", () => {
    it("adds the passage without a comment when Quote is chosen", () => {
      const onAdd = jest.fn();
      render(<ChatQuoteMenu passage="Use Postgres" onAdd={onAdd} />);

      fireEvent.click(screen.getByRole("button", { name: "Quote" }));

      expect(onAdd).toHaveBeenCalledWith();
    });

    it("turns into a comment box under the passage when Comment is chosen and adds the trimmed comment on Enter", () => {
      const onAdd = jest.fn();
      render(<ChatQuoteMenu passage="Use Postgres" onAdd={onAdd} />);

      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      expect(screen.getByText("Use Postgres")).toBeTruthy();
      const box = screen.getByRole("textbox", { name: "Comment" });
      fireEvent.change(box, { target: { value: "  Why not SQLite?  " } });
      fireEvent.keyDown(box, { key: "Enter" });

      expect(onAdd).toHaveBeenCalledWith("Why not SQLite?");
    });

    it("keeps a comment open while it is empty, on Shift+Enter, and on Enter during IME composition for https://github.com/Brevilabs/obsidian-copilot-private/issues/1045", () => {
      const onAdd = jest.fn();
      render(<ChatQuoteMenu passage="Use Postgres" onAdd={onAdd} startCommenting />);
      const box = screen.getByRole("textbox", { name: "Comment" });

      fireEvent.keyDown(box, { key: "Enter" });
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled).toBe(true);
      fireEvent.change(box, { target: { value: "first line" } });
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
      fireEvent.keyDown(box, { key: "Enter", isComposing: true });

      expect(onAdd).not.toHaveBeenCalled();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled).toBe(false);
    });
  });

  describe("ChatQuotePopover()", () => {
    it("offers Quote and Comment for text selected in the chat, then adds that text and clears the selection", () => {
      const { chat, onAdd } = renderTranscript();
      select(chat.querySelector("p")!.firstChild!, 4, 12);

      act(() => {
        fireEvent.pointerUp(chat);
      });
      fireEvent.click(screen.getByRole("button", { name: "Quote" }));

      expect(onAdd).toHaveBeenCalledWith({ content: "Postgres" });
      expect(document.getSelection()?.isCollapsed ?? true).toBe(true);
      expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    });

    it("adds the selected text with the comment written for it", () => {
      const { chat, onAdd } = renderTranscript();
      select(chat.querySelector("p")!.firstChild!);

      act(() => {
        fireEvent.pointerUp(chat);
      });
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      const box = screen.getByRole("textbox", { name: "Comment" });
      fireEvent.change(box, { target: { value: "Why not SQLite?" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(onAdd).toHaveBeenCalledWith({
        content: "Use Postgres for the index.",
        comment: "Why not SQLite?",
      });
    });

    it("follows a selection made or resized with Shift+Arrow and keeps it once the comment box takes focus for https://github.com/Brevilabs/obsidian-copilot-private/issues/1045", () => {
      const { chat, onAdd } = renderTranscript();
      const text = chat.querySelector("p")!.firstChild!;
      select(text, 4, 12);
      act(() => {
        fireEvent.keyUp(document, { key: "ArrowRight", shiftKey: true });
      });
      select(text, 4, 16);
      act(() => {
        fireEvent.keyUp(document, { key: "Shift" });
      });

      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      const box = screen.getByRole("textbox", { name: "Comment" });
      document.getSelection()?.removeAllRanges();
      fireEvent.keyUp(box, { key: "Shift" });
      fireEvent.change(box, { target: { value: "Why not SQLite?" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(onAdd).toHaveBeenCalledWith({ content: "Postgres for", comment: "Why not SQLite?" });
    });

    it("offers nothing for a selection in the composer, which is the user's unsent draft, for https://github.com/Brevilabs/obsidian-copilot-private/issues/1045", () => {
      const { chat } = renderTranscript();
      select(screen.getByTestId("composer").querySelector("p")!.firstChild!);

      act(() => {
        fireEvent.pointerUp(chat);
      });

      expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    });

    it.each([
      { scenario: "outside the chat", target: "outside" },
      { scenario: "of only whitespace", target: "blank" },
    ])("offers nothing for a selection $scenario", ({ target }) => {
      const { chat } = renderTranscript();
      const node =
        target === "outside"
          ? screen.getByTestId("outside").firstChild!
          : chat.appendChild(document.createTextNode("   "));
      select(node);

      act(() => {
        fireEvent.pointerUp(chat);
      });

      expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    });
  });
});
