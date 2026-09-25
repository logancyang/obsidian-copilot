import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ChatMessages, { isChatEmpty } from "@/components/chat-components/ChatMessages";
import { ChatMessage } from "@/types/message";

const mockScrollState = { paused: false, onResume: jest.fn() };

jest.mock("@/hooks/useChatScrolling", () => ({
  useChatScrolling: jest.fn(() => ({
    containerMinHeight: 0,
    scrollContainerCallbackRef: jest.fn(),
    contentCallbackRef: jest.fn(),
    onScroll: jest.fn(),
    isScrollPaused: mockScrollState.paused,
    scrollToEnd: mockScrollState.onResume,
    getMessageKey: () => "message",
  })),
}));
jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ sourcePath }: { sourcePath: string }) => (
    <div data-testid="message-source">{sourcePath}</div>
  ),
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

describe("ChatMessages", () => {
  describe("ChatMessages()", () => {
    beforeEach(() => {
      mockScrollState.paused = false;
      mockScrollState.onResume.mockClear();
    });

    it("forwards its saved conversation path to the shared renderer https://github.com/Brevilabs/obsidian-copilot-private/issues/539", () => {
      render(
        <ChatMessages
          sourcePath="chat/Conversation.md"
          chatHistory={[message()]}
          currentAiMessage=""
          app={{} as never}
          onRegenerate={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
      );
      expect(screen.getByTestId("message-source").textContent).toBe("chat/Conversation.md");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 shows a return control above a paused transcript and resumes following on click", () => {
      mockScrollState.paused = true;
      render(
        <ChatMessages
          chatHistory={[message()]}
          currentAiMessage=""
          app={{} as never}
          onRegenerate={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Scroll to end" }));
      expect(mockScrollState.onResume).toHaveBeenCalledTimes(1);
    });
  });

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
});
