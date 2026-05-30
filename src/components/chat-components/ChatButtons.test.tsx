import React from "react";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { USER_SENDER } from "@/constants";
import type { ChatMessage } from "@/types/message";

// `cleanMessageForCopy` is a thin stand-in here — its real sanitization is
// covered in utils.test.ts. This keeps the heavy `@/utils` module (langchain,
// luxon, obsidian) out of the component test.
jest.mock("@/utils", () => ({
  cleanMessageForCopy: (s: string) => s,
}));

jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
}));

function message(sender: string): ChatMessage {
  return { sender, message: "body", isVisible: true, timestamp: null };
}

function renderButtons(props: Partial<React.ComponentProps<typeof ChatButtons>>) {
  return render(
    <TooltipProvider>
      <ChatButtons message={message(USER_SENDER)} hasSources={false} {...props} />
    </TooltipProvider>
  );
}

beforeAll(() => {
  // Radix tooltip portals render into Obsidian's `activeDocument` global.
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ChatButtons lifecycle-action gating", () => {
  describe("user message", () => {
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

  describe("assistant message", () => {
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
    });
  });
});
