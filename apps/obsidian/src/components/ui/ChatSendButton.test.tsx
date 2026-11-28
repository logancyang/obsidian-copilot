import { ChatSendButton } from "@/components/ui/ChatSendButton";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("ChatSendButton", () => {
  describe("ChatSendButton()", () => {
    it.each([
      [true, false],
      [false, true],
    ])(
      "renders canSend=%p with disabled=%p and sends only when enabled https://github.com/logancyang/obsidian-copilot/issues/2850",
      (canSend, disabled) => {
        const onSend = jest.fn();
        render(<ChatSendButton canSend={canSend} onSend={onSend} />);
        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
        expect(button.disabled).toBe(disabled);
        fireEvent.click(button);
        expect(onSend).toHaveBeenCalledTimes(disabled ? 0 : 1);
      }
    );
  });
});
