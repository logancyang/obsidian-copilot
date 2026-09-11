import { ChatHistoryPopover } from "@/components/chat-components/ChatHistoryPopover";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({ chatHistorySortStrategy: "recent" })),
}));

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/429";
const history = ["Open research", "Saved research"].map((title) => ({
  id: title,
  title,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
}));

describe("ChatHistoryPopover", () => {
  beforeEach(() => {
    window.IntersectionObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    })) as unknown as typeof IntersectionObserver;
  });
  describe("ChatHistoryPopover()", () => {
    it(`${issue} closes an open session while preserving its saved history and leaving the popover open`, async () => {
      const onCloseSession = jest.fn(async () => {});
      const onLoadChat = jest.fn(async () => {});
      const onDeleteChat = jest.fn(async () => {});
      const props = {
        chatHistory: history,
        onUpdateTitle: jest.fn(),
        onDeleteChat,
        onLoadChat,
        onCloseSession,
      };
      const { rerender } = render(
        <ChatHistoryPopover {...props} openChatIds={new Set([history[0].id])}>
          <button type="button">History</button>
        </ChatHistoryPopover>
      );
      fireEvent.click(screen.getByText("History"));
      expect(screen.getAllByLabelText("Session open")).toHaveLength(1);
      const button = screen.getByRole("button", { name: "Close session" });
      fireEvent.keyDown(button, { key: "Enter" });
      await act(async () => fireEvent.click(button));
      expect(onCloseSession).toHaveBeenCalledWith(history[0].id);
      expect(onLoadChat).not.toHaveBeenCalled();
      expect(onDeleteChat).not.toHaveBeenCalled();
      rerender(
        <ChatHistoryPopover {...props} openChatIds={new Set()}>
          <button type="button">History</button>
        </ChatHistoryPopover>
      );
      expect(screen.queryByLabelText("Session open")).toBeNull();
      expect(screen.queryByRole("button", { name: "Close session" })).toBeNull();
      expect(screen.getByText("Open research")).toBeTruthy();
      expect(screen.getByText("Saved research")).toBeTruthy();
      await act(async () =>
        fireEvent.keyDown(screen.getByRole("button", { name: "Open research" }), { key: "Enter" })
      );
      expect(onLoadChat).toHaveBeenCalledWith(history[0].id);
    });
  });
});
