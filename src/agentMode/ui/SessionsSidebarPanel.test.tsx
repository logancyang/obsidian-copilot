import { SessionsSidebarPanel } from "@/agentMode/ui/SessionsSidebarPanel";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const NONE: ReadonlySet<string> = new Set();

function chat(
  id: string,
  title: string,
  lastAccessedMs: number,
  extra: Partial<ChatHistoryItem> = {}
) {
  return {
    id,
    title,
    createdAt: new Date(1_000),
    lastAccessedAt: new Date(lastAccessedMs),
    ...extra,
  } satisfies ChatHistoryItem;
}

const CHATS = [
  chat("chats/oldest.md", "Oldest chat", 1_000),
  chat("chats/newest.md", "Newest chat", 3_000),
  chat("chats/middle.md", "Middle chat", 2_000),
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof SessionsSidebarPanel>> = {}) {
  const props = {
    items: CHATS,
    activeChatIds: NONE,
    runningChatIds: NONE,
    waitingChatIds: NONE,
    attentionChatIds: NONE,
    openChatIds: NONE,
    onNewChat: jest.fn(),
    onOpenChat: jest.fn(),
    onCloseSession: jest.fn(),
    ...overrides,
  };
  render(<SessionsSidebarPanel {...props} />);
  return props;
}

function rowTitles(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("button")
    .map((row) => row.textContent!.trim());
}

describe("SessionsSidebarPanel", () => {
  describe("SessionsSidebarPanel()", () => {
    it("lists saved chats newest first by last use for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderPanel();

      expect(rowTitles()).toEqual(["Newest chat", "Middle chat", "Oldest chat"]);
    });

    it("explains that no chats exist yet instead of showing an empty list for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderPanel({ items: [] });

      expect(screen.getByText("No chats yet")).toBeTruthy();
      expect(screen.queryByRole("list")).toBeNull();
    });

    it("starts a new chat from the header button for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { onNewChat } = renderPanel();

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
    });

    it("opens the clicked chat by its history id for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { onOpenChat } = renderPanel();

      fireEvent.click(screen.getByRole("button", { name: "Middle chat" }));

      expect(onOpenChat).toHaveBeenCalledWith("chats/middle.md");
    });

    it("highlights only the row of the active chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderPanel({ activeChatIds: new Set(["chats/middle.md", "native:opencode:s1"]) });

      const current = screen
        .getAllByRole("button")
        .filter((row) => row.getAttribute("aria-current") === "true");
      expect(current.map((row) => row.textContent!.trim())).toEqual(["Middle chat"]);
    });

    it.each([
      ["running", { runningChatIds: new Set(["chats/middle.md"]) }, "Running"],
      [
        "waiting for permission",
        { waitingChatIds: new Set(["chats/middle.md"]) },
        "Waiting for permission",
      ],
      ["unread", { attentionChatIds: new Set(["chats/middle.md"]) }, "Unread result"],
    ])(
      "marks a %s chat's row with its status for https://github.com/Brevilabs/obsidian-copilot-private/issues/801",
      (_label, sets, statusLabel) => {
        renderPanel(sets);

        const row = screen.getByRole("button", { name: /Middle chat/ });
        expect(within(row).getByLabelText(statusLabel)).toBeTruthy();
        const others = screen.getAllByRole("button", { name: /(Newest|Oldest) chat/ });
        for (const other of others) expect(within(other).queryByLabelText(statusLabel)).toBeNull();
      }
    );

    it("clears the unread dot once the live attention flag clears even if the saved snapshot still carries it for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderPanel({
        items: [chat("chats/flagged.md", "Flagged chat", 1_000, { needsAttention: true })],
        attentionChatIds: NONE,
      });

      expect(screen.queryByLabelText("Unread result")).toBeNull();
    });

    it("marks only chats with a live session and closes that session by its history id for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { onCloseSession, onOpenChat } = renderPanel({
        openChatIds: new Set(["chats/middle.md"]),
      });

      expect(screen.getAllByLabelText("Session open")).toHaveLength(1);
      expect(
        within(screen.getByRole("button", { name: /Middle chat/ })).getByLabelText("Session open")
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

      expect(onCloseSession).toHaveBeenCalledWith("chats/middle.md");
      expect(onOpenChat).not.toHaveBeenCalled();
    });

    it("shows no status on an idle chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderPanel();

      expect(screen.queryByLabelText("Running")).toBeNull();
      expect(screen.queryByLabelText("Waiting for permission")).toBeNull();
      expect(screen.queryByLabelText("Unread result")).toBeNull();
    });
  });
});
