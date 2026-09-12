import {
  CloseSessionButton,
  OpenSessionIndicator,
} from "@/components/chat-components/ui/OpenSessionControls";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/429";

describe("OpenSessionControls", () => {
  describe("OpenSessionIndicator()", () => {
    it(`${issue} labels an open session independently of turn activity`, () => {
      render(<OpenSessionIndicator />);
      expect(screen.getByLabelText("Session open").title).toBe("Session open");
    });
  });
  describe("CloseSessionButton()", () => {
    it(`${issue} releases the selected session once while pending without activating its row`, async () => {
      let finish!: () => void;
      const onCloseSession = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      const onOpen = jest.fn();
      render(
        <div onClick={onOpen} onKeyDown={onOpen}>
          <CloseSessionButton chatId="research" onCloseSession={onCloseSession} />
        </div>
      );
      const button = screen.getByRole("button", { name: "Close session" });
      fireEvent.keyDown(button, { key: "Enter" });
      fireEvent.keyDown(button, { key: " " });
      fireEvent.click(button);
      expect(button.hasAttribute("disabled")).toBe(true);
      fireEvent.click(button);
      expect(onCloseSession).toHaveBeenCalledTimes(1);
      expect(onCloseSession).toHaveBeenCalledWith("research");
      expect(onOpen).not.toHaveBeenCalled();
      await act(async () => finish());
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    it.each([
      { reason: new Error("backend unavailable"), message: "backend unavailable" },
      { reason: undefined, message: "Try again." },
    ])(
      `${issue} explains a failed close ($message) and permits retry`,
      async ({ reason, message }) => {
        const onCloseSession = jest.fn().mockRejectedValueOnce(reason).mockResolvedValue(undefined);
        render(<CloseSessionButton chatId="research" onCloseSession={onCloseSession} />);
        const button = screen.getByRole("button", { name: "Close session" });
        await act(async () => fireEvent.click(button));
        expect(screen.getByRole("alert").textContent).toBe(`Could not close session: ${message}`);
        expect(button.hasAttribute("disabled")).toBe(false);
        await act(async () => fireEvent.click(button));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(onCloseSession).toHaveBeenCalledTimes(2);
      }
    );
  });
});
