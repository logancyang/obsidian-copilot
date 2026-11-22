import {
  ChatTranscriptViewport,
  type ChatTranscriptViewportProps,
} from "@/components/chat-components/ui/ChatTranscriptViewport";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function props(overrides: Partial<ChatTranscriptViewportProps> = {}): ChatTranscriptViewportProps {
  return {
    children: <p>Latest response</p>,
    scrollContainerRef: jest.fn(),
    contentRef: jest.fn(),
    onScroll: jest.fn(),
    isScrollPaused: false,
    scrollToEnd: jest.fn(),
    ...overrides,
  };
}

describe("ChatTranscriptViewport", () => {
  describe("ChatTranscriptViewport()", () => {
    it("shows the response without a return control while following the end", () => {
      render(<ChatTranscriptViewport {...props()} />);

      expect(screen.getByText("Latest response")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 shows the floating return control while paused and resumes on click", () => {
      const scrollToEnd = jest.fn();
      render(<ChatTranscriptViewport {...props({ isScrollPaused: true, scrollToEnd })} />);

      fireEvent.click(screen.getByRole("button", { name: "Scroll to end" }));
      expect(scrollToEnd).toHaveBeenCalledTimes(1);
    });

    it("passes reader scrolling to the scroll state owner", () => {
      const onScroll = jest.fn();
      render(<ChatTranscriptViewport {...props({ onScroll })} />);

      fireEvent.scroll(screen.getByTestId("chat-messages"));
      expect(onScroll).toHaveBeenCalledTimes(1);
    });
  });
});
