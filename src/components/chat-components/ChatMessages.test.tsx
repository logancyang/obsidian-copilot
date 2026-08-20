import ChatMessages, { isChatEmpty } from "@/components/chat-components/ChatMessages";
import { USER_SENDER } from "@/constants";
import type { ChatMessage } from "@/types/message";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const scrollingMockState = {
  isAtBottom: true,
  jumpToLatest: jest.fn(),
  scrollBy: jest.fn(),
};

jest.mock("@/hooks/useChatScrolling", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatScrolling: () => ({
    containerMinHeight: 0,
    scrollContainerCallbackRef: jest.fn(),
    contentCallbackRef: jest.fn(),
    getMessageKey: (message: { id?: string }, index: number) => message.id ?? `${index}`,
    isAtBottom: scrollingMockState.isAtBottom,
    jumpToLatest: scrollingMockState.jumpToLatest,
    scrollBy: scrollingMockState.scrollBy,
  }),
}));

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { message: string } }) => <div>{message.message}</div>,
}));

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    message: "hello",
    sender: "user",
    isVisible: true,
    timestamp: null,
    ...overrides,
  };
}

function userMessage(id: string, text: string): ChatMessage {
  return {
    id,
    sender: USER_SENDER,
    message: text,
    timestamp: { epoch: 1_000, display: "", fileName: "" },
    isVisible: true,
  };
}

function renderMessages(chatHistory: ChatMessage[], currentAiMessage = "") {
  return render(
    <ChatMessages
      chatHistory={chatHistory}
      currentAiMessage={currentAiMessage}
      app={{} as never}
      onRegenerate={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
    />
  );
}

describe("ChatMessages", () => {
  describe("isChatEmpty()", () => {
    it("reports an empty chat when there is no message and nothing streaming", () => {
      expect(isChatEmpty([], "")).toBe(true);
    });

    it("reports an empty chat when every message is hidden", () => {
      expect(isChatEmpty([message({ isVisible: false })], "")).toBe(true);
    });

    it("reports a non-empty chat once a visible message exists", () => {
      expect(isChatEmpty([message()], "")).toBe(false);
    });

    it("reports a non-empty chat while an AI response is still streaming into an empty history", () => {
      expect(isChatEmpty([], "thinking...")).toBe(false);
    });

    it("reports a non-empty chat when a hidden message accompanies a streaming response", () => {
      expect(isChatEmpty([message({ isVisible: false })], "thinking...")).toBe(false);
    });
  });

  describe("ChatMessages()", () => {
    beforeEach(() => {
      scrollingMockState.isAtBottom = true;
      scrollingMockState.jumpToLatest = jest.fn();
      scrollingMockState.scrollBy = jest.fn();
    });

    it("hides the scroll-to-bottom button while the viewport rests at the newest message (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      renderMessages([userMessage("m1", "hello")]);

      expect(screen.queryByLabelText("Scroll to latest message")).toBeNull();
    });

    it("shows the scroll-to-bottom button after scrolling away and jumps back on click (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = false;
      renderMessages([userMessage("m1", "hello")]);

      const button = screen.getByLabelText("Scroll to latest message");
      act(() => button.click());
      expect(scrollingMockState.jumpToLatest).toHaveBeenCalledTimes(1);
    });

    it("forwards wheel deltas from the button to the message list so hovering it never traps scrolling (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = false;
      renderMessages([userMessage("m1", "hello")]);

      fireEvent.wheel(screen.getByLabelText("Scroll to latest message"), { deltaY: -80 });
      expect(scrollingMockState.scrollBy).toHaveBeenCalledWith(-80);
    });

    it("swaps the arrow for a bouncing typing indicator while a response is streaming (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = false;
      const { container } = renderMessages([userMessage("m1", "hello")], "partial reply");

      const button = screen.getByLabelText("Scroll to latest message");
      expect(container.querySelectorAll(".copilot-typing-dot")).toHaveLength(3);
      expect(button.querySelector("svg")).toBeNull();
    });
  });
});
