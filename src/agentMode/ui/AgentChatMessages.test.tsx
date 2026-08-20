import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentChatMessage } from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { act, render, screen } from "@testing-library/react";
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
    getMessageKey: (message: { id: string }) => message.id,
    isAtBottom: scrollingMockState.isAtBottom,
    jumpToLatest: scrollingMockState.jumpToLatest,
    scrollBy: scrollingMockState.scrollBy,
  }),
}));

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({
    message,
    footerStart,
    collapseLongUserMessages,
  }: {
    message: { message: string };
    footerStart?: React.ReactNode;
    collapseLongUserMessages?: boolean;
  }) => (
    <div data-collapse-long-user-messages={collapseLongUserMessages ? "true" : "false"}>
      {message.message}
      <div data-testid="single-message-footer">{footerStart}</div>
    </div>
  ),
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({ timestamp }: { timestamp?: string }) => (
    <div data-testid="agent-trail-timestamp">{timestamp}</div>
  ),
}));

function assistantMessage(
  id: string,
  timestampMs: number,
  overrides: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return {
    id,
    sender: AI_SENDER,
    message: "Finished response",
    timestamp: { epoch: timestampMs, display: "", fileName: "" },
    isVisible: true,
    ...overrides,
  };
}

function renderMessages(messages: AgentChatMessage[], isLoading: boolean) {
  return render(
    <AgentChatMessages
      messages={messages}
      app={{} as never}
      currentPlan={null}
      pendingToolPermissions={[]}
      pendingAskUserQuestions={[]}
      chatBackend={{} as AgentChatBackend}
      isLoading={isLoading}
    />
  );
}

describe("AgentChatMessages", () => {
  describe("AgentChatMessages()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
      scrollingMockState.isAtBottom = true;
      scrollingMockState.jumpToLatest = jest.fn();
      scrollingMockState.scrollBy = jest.fn();
    });

    afterEach(() => jest.useRealTimers());

    it("retains the latest completed turn duration with a static icon", () => {
      const { container } = renderMessages(
        [assistantMessage("answer-1", 62_000, { turnDurationMs: 138_000 })],
        false
      );

      expect(screen.getByText("2m 18s")).toBeTruthy();
      expect(screen.getByTestId("single-message-footer").textContent).toContain(
        "Worked for 2m 18s"
      );
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner-dot-0")).toBeNull();
    });

    it("retires the prior duration when the next turn starts", () => {
      const { container } = renderMessages(
        [
          assistantMessage("answer-1", 1_000, { turnDurationMs: 51_000 }),
          assistantMessage("answer-2", 198_000, { message: "", parts: [] }),
        ],
        true
      );

      expect(screen.queryByText("51s")).toBeNull();
      expect(screen.getByText("2s")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();

      act(() => jest.advanceTimersByTime(1_000));
      expect(screen.getByText("3s")).toBeTruthy();
    });

    it("passes the message timestamp to a structured trail without a duration", () => {
      const timestamp = "2026/08/07 20:31:10";
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            timestamp: { epoch: 62_000, display: timestamp, fileName: "20260807_203110" },
            parts: [{ kind: "thought", text: "Inspect the response." }],
          }),
        ],
        false
      );

      expect(screen.getByTestId("agent-trail-timestamp").textContent).toBe(timestamp);
    });

    it("opts Agent Chat messages into long user text collapse (https://github.com/Brevilabs/obsidian-copilot-private/issues/151)", () => {
      renderMessages(
        [
          {
            id: "prompt-1",
            sender: USER_SENDER,
            message: "A long pasted prompt",
            timestamp: { epoch: 1, display: "", fileName: "" },
            isVisible: true,
          },
        ],
        false
      );

      expect(
        screen
          .getByText("A long pasted prompt")
          .closest("[data-collapse-long-user-messages]")
          ?.getAttribute("data-collapse-long-user-messages")
      ).toBe("true");
    });

    it("hides the scroll-to-bottom button while the viewport rests at the newest message (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = true;
      renderMessages([assistantMessage("answer-1", 62_000)], false);

      expect(screen.queryByLabelText("Scroll to latest message")).toBeNull();
    });

    it("shows the scroll-to-bottom button after scrolling away and jumps back on click (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = false;
      scrollingMockState.jumpToLatest = jest.fn();
      renderMessages([assistantMessage("answer-1", 62_000)], false);

      const button = screen.getByLabelText("Scroll to latest message");
      act(() => button.click());
      expect(scrollingMockState.jumpToLatest).toHaveBeenCalledTimes(1);
    });

    it("swaps the arrow for a bouncing typing indicator while a turn is streaming (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      scrollingMockState.isAtBottom = false;
      const { container } = renderMessages(
        [assistantMessage("answer-1", 62_000, { message: "", parts: [] })],
        true
      );

      const button = screen.getByLabelText("Scroll to latest message");
      expect(container.querySelectorAll(".copilot-typing-dot")).toHaveLength(3);
      expect(button.querySelector("svg")).toBeNull();
    });
  });
});
