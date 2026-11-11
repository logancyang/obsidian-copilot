import { act, renderHook } from "@testing-library/react";
import {
  useChatSelection,
  type SelectionClick,
  type SelectionKeyDown,
} from "@/agentMode/ui/hooks/useChatSelection";

const PLAIN: SelectionClick = { shiftKey: false, metaKey: false, ctrlKey: false };
const SHIFT: SelectionClick = { ...PLAIN, shiftKey: true };
const CMD: SelectionClick = { ...PLAIN, metaKey: true };
const CTRL: SelectionClick = { ...PLAIN, ctrlKey: true };

const CHATS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

const LIST = document.createElement("div");
const LIST_ROW = LIST.appendChild(document.createElement("div"));

function escapeFrom(target: Element, stopPropagation: () => void): SelectionKeyDown {
  return { key: "Escape", stopPropagation, target, currentTarget: LIST };
}

function renderSelection(items: readonly { id: string }[] = CHATS) {
  return renderHook(({ visible }) => useChatSelection(visible), {
    initialProps: { visible: items },
  });
}

function selectedIds(result: { current: ReturnType<typeof useChatSelection> }): string[] {
  return result.current.selectedItems.map((item) => item.id);
}

describe("useChatSelection", () => {
  describe("useChatSelection()", () => {
    it("starts with no chat selected", () => {
      const { result } = renderSelection();
      expect(selectedIds(result)).toEqual([]);
      expect(result.current.isSelected("a")).toBe(false);
    });

    it("returns the same empty list on every render while nothing is selected", () => {
      const { result, rerender } = renderSelection();
      const first = result.current.selectedItems;
      rerender({ visible: [...CHATS] });
      expect(result.current.selectedItems).toBe(first);
    });
  });

  describe("handleClick()", () => {
    it("leaves a plain click to open the chat and selects nothing", () => {
      const { result } = renderSelection();
      let handled = true;
      act(() => {
        handled = result.current.handleClick("b", PLAIN);
      });
      expect(handled).toBe(false);
      expect(selectedIds(result)).toEqual([]);
    });

    it("adds a Cmd-clicked or Ctrl-clicked chat to the selection and keeps the click from opening it", () => {
      const { result } = renderSelection();
      let handled = false;
      act(() => {
        handled = result.current.handleClick("b", CMD);
      });
      act(() => {
        result.current.handleClick("d", CTRL);
      });
      expect(handled).toBe(true);
      expect(selectedIds(result)).toEqual(["b", "d"]);
    });

    it("removes a selected chat when it is Cmd-clicked again", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("b", CMD);
      });
      act(() => {
        result.current.handleClick("d", CMD);
      });
      act(() => {
        result.current.handleClick("b", CMD);
      });
      expect(selectedIds(result)).toEqual(["d"]);
    });

    it("selects every listed chat between the last clicked chat and a Shift-clicked one, in either direction", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("d", CMD);
      });
      act(() => {
        result.current.handleClick("b", SHIFT);
      });
      expect(selectedIds(result)).toEqual(["b", "c", "d"]);
    });

    it("replaces the previous range when Shift-clicking a different chat from the same starting chat", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("b", CMD);
      });
      act(() => {
        result.current.handleClick("e", SHIFT);
      });
      act(() => {
        result.current.handleClick("c", SHIFT);
      });
      expect(selectedIds(result)).toEqual(["b", "c"]);
    });

    it("selects just the Shift-clicked chat and starts a range there when no chat was clicked before", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("c", SHIFT);
      });
      expect(selectedIds(result)).toEqual(["c"]);
      act(() => {
        result.current.handleClick("e", SHIFT);
      });
      expect(selectedIds(result)).toEqual(["c", "d", "e"]);
    });

    it("clears the selection on a plain click", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.handleClick("c", PLAIN);
      });
      expect(selectedIds(result)).toEqual([]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3553 starts a Shift-click range at the chat a plain click opened", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("b", PLAIN);
      });
      act(() => {
        result.current.handleClick("d", SHIFT);
      });
      expect(selectedIds(result)).toEqual(["b", "c", "d"]);
    });

    it("lists selected chats in the order they are shown, not the order they were clicked", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("e", CMD);
      });
      act(() => {
        result.current.handleClick("a", CMD);
      });
      expect(selectedIds(result)).toEqual(["a", "e"]);
    });

    it("drops a selected chat once it leaves the list, such as after it is deleted or archived", () => {
      const { result, rerender } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.handleClick("c", CMD);
      });
      rerender({ visible: CHATS.filter((chat) => chat.id !== "c") });
      expect(selectedIds(result)).toEqual(["a"]);
      expect(result.current.isSelected("c")).toBe(false);
    });
  });

  describe("handleContextMenu()", () => {
    it("keeps the selection when the right-clicked chat is part of it", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.handleClick("b", CMD);
      });
      act(() => {
        result.current.handleContextMenu("b");
      });
      expect(selectedIds(result)).toEqual(["a", "b"]);
    });

    it("clears the selection when the right-clicked chat is not part of it", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.handleContextMenu("d");
      });
      expect(selectedIds(result)).toEqual([]);
    });
  });

  describe("handleKeyDown()", () => {
    it("clears the selection on Escape inside the list and stops the key from closing anything else", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      const stopPropagation = jest.fn();
      act(() => {
        result.current.handleKeyDown(escapeFrom(LIST_ROW, stopPropagation));
      });
      expect(selectedIds(result)).toEqual([]);
      expect(stopPropagation).toHaveBeenCalled();
    });

    it("lets Escape through when nothing is selected", () => {
      const { result } = renderSelection();
      const stopPropagation = jest.fn();
      act(() => {
        result.current.handleKeyDown(escapeFrom(LIST_ROW, stopPropagation));
      });
      expect(stopPropagation).not.toHaveBeenCalled();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3553 keeps the selection when Escape comes from a menu rendered outside the list", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.handleKeyDown(escapeFrom(document.createElement("div"), jest.fn()));
      });
      expect(selectedIds(result)).toEqual(["a"]);
    });
  });

  describe("clear()", () => {
    it("deselects every chat", () => {
      const { result } = renderSelection();
      act(() => {
        result.current.handleClick("a", CMD);
      });
      act(() => {
        result.current.clear();
      });
      expect(selectedIds(result)).toEqual([]);
    });
  });
});
