import { ScrollToBottomButton } from "@/components/chat-components/ScrollToBottomButton";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderButton(props: Partial<React.ComponentProps<typeof ScrollToBottomButton>> = {}) {
  return render(<ScrollToBottomButton onClick={jest.fn()} onScrollWheel={jest.fn()} {...props} />);
}

describe("ScrollToBottomButton", () => {
  describe("ScrollToBottomButton()", () => {
    it("renders an accessible circular affordance with the down arrow by default (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const { container } = renderButton();

      const button = screen.getByLabelText("Scroll to latest message");
      expect(button.querySelector("svg")).toBeTruthy();
      expect(container.querySelectorAll(".copilot-typing-dot")).toHaveLength(0);
    });

    it("invokes onClick when the user asks to jump back to the newest message (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const onClick = jest.fn();
      renderButton({ onClick });

      act(() => screen.getByLabelText("Scroll to latest message").click());
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("forwards wheel deltas so hovering the button never traps scrolling (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const onScrollWheel = jest.fn();
      renderButton({ onScrollWheel });

      fireEvent.wheel(screen.getByLabelText("Scroll to latest message"), { deltaY: 120 });
      expect(onScrollWheel).toHaveBeenCalledWith(120);
    });

    it("swaps the arrow for three bouncing typing dots while a response is streaming (https://github.com/logancyang/obsidian-copilot-preview/issues/329)", () => {
      const { container } = renderButton({ isStreaming: true });

      const button = screen.getByLabelText("Scroll to latest message");
      expect(container.querySelectorAll(".copilot-typing-dot")).toHaveLength(3);
      expect(button.querySelector("svg")).toBeNull();
    });
  });
});
