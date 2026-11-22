import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("ChatSendButton", () => {
  describe("ChatSendButton()", () => {
    it.each([
      ["", 0, true],
      [" ", 1, false],
      ["Explain", 0, false],
    ])(
      "renders draft %p with %p images with disabled=%p https://github.com/logancyang/obsidian-copilot/issues/2850",
      (input, count, disabled) => {
        const onSend = jest.fn();
        render(<ChatSendButton inputMessage={input} imageCount={count} onSend={onSend} />);
        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
        expect(button.disabled).toBe(disabled);
        fireEvent.click(button);
        expect(onSend).toHaveBeenCalledTimes(disabled ? 0 : 1);
      }
    );
  });
});
