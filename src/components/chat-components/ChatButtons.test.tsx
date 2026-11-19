import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { USER_SENDER } from "@/constants";
import type { ChatMessage } from "@/types/message";

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (s: string) => s,
}));

const mockCopy = jest.fn();
jest.mock("@/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: jest.fn(() => ({ isCopied: false, copy: mockCopy })),
}));

interface FakeMenuItem {
  title: string;
  icon: string | null;
  isLabel: boolean;
  click?: () => void;
}

const mockMenus: { items: FakeMenuItem[]; shown: boolean }[] = [];

jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
  Menu: class {
    record = { items: [] as FakeMenuItem[], shown: false };
    constructor() {
      mockMenus.push(this.record);
    }
    addItem(build: (item: unknown) => void) {
      const entry: FakeMenuItem = { title: "", icon: null, isLabel: false };
      const item = {
        setTitle: (title: string) => ((entry.title = title), item),
        setIcon: (icon: string) => ((entry.icon = icon), item),
        setIsLabel: (isLabel: boolean) => ((entry.isLabel = isLabel), item),
        onClick: (click: () => void) => ((entry.click = click), item),
      };
      build(item);
      this.record.items.push(entry);
      return this;
    }
    showAtMouseEvent() {
      this.record.shown = true;
      return this;
    }
  },
}));

const { Platform } = jest.requireMock<{ Platform: { isMobile: boolean } }>("obsidian");

function message(sender: string): ChatMessage {
  return { sender, message: "body", isVisible: true, timestamp: null };
}

function renderButtons(props: Partial<React.ComponentProps<typeof ChatButtons>>) {
  return render(
    <TooltipProvider>
      <ChatButtons message={message(USER_SENDER)} text="body" hasSources={false} {...props} />
    </TooltipProvider>
  );
}

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ChatButtons", () => {
  describe("ChatButtons() for a user message", () => {
    it("shows Edit and Delete when their handlers are provided", () => {
      renderButtons({ message: message(USER_SENDER), onEdit: () => {}, onDelete: () => {} });
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.getByTitle("Edit")).toBeTruthy();
      expect(screen.getByTitle("Delete")).toBeTruthy();
    });

    it("hides Edit and Delete when no handlers are provided (Agent Mode)", () => {
      renderButtons({ message: message(USER_SENDER) });
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.queryByTitle("Edit")).toBeNull();
      expect(screen.queryByTitle("Delete")).toBeNull();
    });
  });

  describe("ChatButtons() for an assistant message", () => {
    it("shows Regenerate and Delete when their handlers are provided", () => {
      renderButtons({
        message: message("AI"),
        onInsertIntoEditor: () => {},
        onRegenerate: () => {},
        onDelete: () => {},
      });
      expect(screen.getByTitle("Insert / Replace at cursor")).toBeTruthy();
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.getByTitle("Regenerate")).toBeTruthy();
      expect(screen.getByTitle("Delete")).toBeTruthy();
    });

    it("keeps Insert / Copy but hides Regenerate and Delete with no handlers (Agent Mode)", () => {
      renderButtons({ message: message("AI"), onInsertIntoEditor: () => {} });
      expect(screen.getByTitle("Insert / Replace at cursor")).toBeTruthy();
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.queryByTitle("Regenerate")).toBeNull();
      expect(screen.queryByTitle("Delete")).toBeNull();
      expect(screen.queryByTitle("Continue from here in a new chat")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 copies the text it is given, which is the whole response when the reply ends one", () => {
      renderButtons({ message: message("AI"), text: "I asked Maya.\n\nThe year is fixed." });

      fireEvent.click(screen.getByTitle("Copy"));

      expect(mockCopy).toHaveBeenCalledWith("I asked Maya.\n\nThe year is fixed.");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 shows Continue from here in a new chat after Copy when its handler is provided", () => {
      const onContinue = jest.fn();
      renderButtons({ message: message("AI"), onContinue });

      fireEvent.click(screen.getByTitle("Continue from here in a new chat"));

      expect(onContinue).toHaveBeenCalledTimes(1);
    });
  });

  describe("ChatButtons() on a phone, where the platform is switched for each case", () => {
    beforeEach(() => {
      Platform.isMobile = true;
      mockMenus.length = 0;
    });

    afterEach(() => {
      Platform.isMobile = false;
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 shows one Message actions button and none of the message's own buttons", () => {
      renderButtons({ message: message("AI"), onInsertIntoEditor: () => {}, onDelete: () => {} });

      expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
        "Message actions",
      ]);
      expect(screen.queryByTitle("Copy")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 opens a menu naming the speaker above the reply's actions, in the order the desktop shows them", () => {
      renderButtons({
        message: message("AI"),
        hasSources: true,
        onShowSources: () => {},
        onInsertIntoEditor: () => {},
        onContinue: () => {},
        onRegenerate: () => {},
        onDelete: () => {},
      });

      fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

      expect(mockMenus).toHaveLength(1);
      expect(mockMenus[0].shown).toBe(true);
      expect(mockMenus[0].items.map((i) => [i.title, i.isLabel])).toEqual([
        ["Copilot", true],
        ["Show sources", false],
        ["Insert / Replace at cursor", false],
        ["Copy", false],
        ["Continue from here in a new chat", false],
        ["Regenerate", false],
        ["Delete", false],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 names you as the speaker of your own message and lists its Copy, Edit and Delete", () => {
      renderButtons({ message: message(USER_SENDER), onEdit: () => {}, onDelete: () => {} });

      fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

      expect(mockMenus[0].items.map((i) => i.title)).toEqual(["You", "Copy", "Edit", "Delete"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 runs the chosen action from the menu", () => {
      const onEdit = jest.fn();
      const onDelete = jest.fn();
      renderButtons({ message: message(USER_SENDER), onEdit, onDelete });
      fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

      mockMenus[0].items.find((i) => i.title === "Edit")?.click?.();

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 copies the message's text from the menu's Copy", () => {
      renderButtons({ message: message(USER_SENDER) });
      fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

      mockMenus[0].items.find((i) => i.title === "Copy")?.click?.();

      expect(mockCopy).toHaveBeenCalledWith("body");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 leaves a press and hold on the message to the phone, opening no menu of its own", () => {
      const { container } = renderButtons({ message: message(USER_SENDER) });

      fireEvent.contextMenu(container);
      fireEvent.pointerDown(container);

      expect(mockMenus).toHaveLength(0);
    });
  });
});
