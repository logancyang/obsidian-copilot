import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ChatMessages, { isChatEmpty } from "@/components/chat-components/ChatMessages";
import { ChatMessage } from "@/types/message";

const mockScrollState = { paused: false, onResume: jest.fn() };

jest.mock("@/hooks/useChatScrolling", () => ({
  useChatScrolling: jest.fn(() => ({
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
  default: ({ sourcePath, message }: { sourcePath: string; message: ChatMessage }) => (
    <div data-testid="message-source" data-text={message.message}>
      {sourcePath}
    </div>
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

    it("paces a streamed burst into the reply word by word instead of showing it at once https://github.com/Brevilabs/obsidian-copilot-private/issues/886", () => {
      jest.useFakeTimers();
      const burst = "First " + "steady word ".repeat(40);
      const view = (currentAiMessage: string) => (
        <ChatMessages
          chatHistory={[]}
          currentAiMessage={currentAiMessage}
          app={{} as never}
          onRegenerate={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
      );
      const { rerender } = render(view("First "));
      const shown = () => screen.getByTestId("message-source").dataset.text ?? "";
      expect(shown()).toBe("First ");
      rerender(view(burst));
      act(() => jest.advanceTimersByTime(20));
      expect(shown().length).toBeGreaterThan("First ".length);
      expect(shown().length).toBeLessThan(burst.length);
      act(() => jest.advanceTimersByTime(300));
      expect(shown()).toBe(burst);
      jest.useRealTimers();
    });

    it("keeps the agent reasoning marker whole while pacing only the reply after it https://github.com/Brevilabs/obsidian-copilot-private/issues/886", () => {
      jest.useFakeTimers();
      const marker = '<!--AGENT_REASONING:reasoning:0:["Gathering my thoughts"]-->';
      const reply = "\n\nFirst " + "steady word ".repeat(40);
      const view = (currentAiMessage: string) => (
        <ChatMessages
          chatHistory={[]}
          currentAiMessage={currentAiMessage}
          app={{} as never}
          onRegenerate={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />
      );
      const { rerender } = render(view(""));
      const shown = () => screen.getByTestId("message-source").dataset.text ?? "";
      rerender(view(marker));
      act(() => jest.advanceTimersByTime(500));
      expect(shown()).toBe(marker);
      rerender(view(marker + reply));
      act(() => jest.advanceTimersByTime(20));
      expect(shown().startsWith(marker + "\n\nFirst ")).toBe(true);
      expect(shown().length).toBeLessThan((marker + reply).length);
      jest.useRealTimers();
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
