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
        expect(screen.queryByRole("tooltip")).toBeNull();
      }
    );

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 stays disabled with a draft and explains why on hover when given a reason", async () => {
      const onSend = jest.fn();
      render(
        <ChatSendButton
          inputMessage="Explain"
          imageCount={0}
          onSend={onSend}
          disabledReason="Loading your model…"
        />
      );
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });

      fireEvent.click(button);
      fireEvent.pointerMove(button.parentElement!);

      expect(button.disabled).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      expect((await screen.findByRole("tooltip")).textContent).toBe("Loading your model…");
    });
  });
});
