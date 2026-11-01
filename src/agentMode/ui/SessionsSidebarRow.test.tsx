import {
  SessionsSidebarRow,
  mostUrgentStatus,
  resolveSessionStatus,
  type SessionStatus,
} from "@/agentMode/ui/SessionsSidebarRow";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { inertChatActions, sidebarChat } from "@/agentMode/ui/testing/sessionsSidebarFixtures";
import { AppContext } from "@/context";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

function renderRow(overrides: Partial<React.ComponentProps<typeof SessionsSidebarRow>> = {}) {
  const props = {
    item: sidebarChat("chats/plan.md", "Plan the fall launch", 5),
    status: "idle" as SessionStatus,
    active: false,
    isSessionOpen: false,
    actions: inertChatActions({ getChatBookmarkState: () => new Promise<never>(() => {}) }),
    onSelect: jest.fn(),
    ...overrides,
  };
  render(
    <AppContext.Provider value={new App()}>
      <SessionsSidebarRow {...props} />
    </AppContext.Provider>
  );
  return props;
}

function openRowMenu(): HTMLElement {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.getByRole("menu");
}

describe("SessionsSidebarRow", () => {
  beforeAll(installRadixMenuPolyfills);

  describe("SessionsSidebarRow()", () => {
    it("shows the chat title as the row's name and selects the chat on click", () => {
      const { onSelect } = renderRow();

      fireEvent.click(screen.getByRole("button", { name: "Plan the fall launch" }));

      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("marks the row as the current chat only when it is active", () => {
      renderRow({ active: true });
      expect(
        screen.getByRole("button", { name: "Plan the fall launch" }).getAttribute("aria-current")
      ).toBe("true");
    });

    it("leaves the row unmarked when it is not active", () => {
      renderRow({ active: false });
      expect(
        screen.getByRole("button", { name: "Plan the fall launch" }).hasAttribute("aria-current")
      ).toBe(false);
    });

    it.each([
      ["running", "Running"],
      ["waiting", "Waiting for permission"],
    ] as const)("labels a %s row with its status icon", (status, label) => {
      renderRow({ status });

      expect(screen.getByLabelText(label)).toBeTruthy();
    });

    it("shows no status icon on an idle row", () => {
      renderRow({ status: "idle" });

      expect(
        screen.getByRole("button", { name: "Plan the fall launch" }).querySelector("[aria-label]")
      ).toBeNull();
    });

    it("marks an idle chat with a live session with a session-open dot for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      expect(within(row).getByLabelText("Session open")).toBeTruthy();
    });

    it("shows only the more urgent status when a chat with a live session is also running for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "running" });

      expect(screen.getByLabelText("Running")).toBeTruthy();
      expect(screen.queryByLabelText("Session open")).toBeNull();
    });

    it("bolds the title of a chat with an unseen result and keeps the session-open dot for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "unread" });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      expect(within(row).getByLabelText("Unread result")).toBeTruthy();
      expect(within(row).getByText("Plan the fall launch").className).toContain("tw-font-semibold");
      expect(within(row).getByLabelText("Session open")).toBeTruthy();
    });

    it("shows a seen chat's title at normal weight for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true });

      expect(screen.getByText("Plan the fall launch").className).not.toContain("tw-font-semibold");
    });

    it("places the status at the row's right end, after the title, for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "waiting" });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      const title = within(row).getByText("Plan the fall launch");
      const status = within(row).getByLabelText("Waiting for permission");
      expect(title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(row.querySelector(".tw-order-first")).toBeNull();
    });

    it("offers Pin chat, Archive chat and More actions, in that order, after the title for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderRow({ isSessionOpen: true });

      const names = screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));

      expect(names).toEqual([null, "Pin chat", "Archive chat", "More actions"]);
    });

    it("keeps the status's space and overlays the hover actions on the row's right end, so hovering moves nothing, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderRow({ isSessionOpen: true });

      const statusSlot = screen.getByLabelText("Session open").parentElement!;
      expect(statusSlot.className).toContain("group-hover:tw-invisible");
      expect(statusSlot.className).not.toContain("group-hover:tw-hidden");
      expect(screen.getByRole("button", { name: "Pin chat" }).parentElement!.className).toContain(
        "tw-absolute"
      );
    });

    it("pins an unpinned chat from its Pin chat button without opening the chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({ onSetChatPinned: jest.fn(async () => {}) });
      const { onSelect } = renderRow({ actions });

      fireEvent.click(screen.getByRole("button", { name: "Pin chat" }));

      expect(actions.onSetChatPinned).toHaveBeenCalledWith("chats/plan.md", true);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("unpins a pinned chat from its Unpin chat button for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({ onSetChatPinned: jest.fn(async () => {}) });
      renderRow({
        item: sidebarChat("chats/plan.md", "Plan the fall launch", 5, { pinnedAt: 1 }),
        actions,
      });

      fireEvent.click(screen.getByRole("button", { name: "Unpin chat" }));

      expect(actions.onSetChatPinned).toHaveBeenCalledWith("chats/plan.md", false);
    });

    it("archives the chat from its Archive chat button without opening the chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({ onSetChatArchived: jest.fn(async () => {}) });
      const { onSelect } = renderRow({ actions });

      fireEvent.click(screen.getByRole("button", { name: "Archive chat" }));

      expect(actions.onSetChatArchived).toHaveBeenCalledWith("chats/plan.md", true);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("closes a live session from the row menu's Close chat item without opening the chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({
        onCloseSession: jest.fn(async () => {}),
        getChatBookmarkState: () => new Promise<never>(() => {}),
      });
      const { onSelect } = renderRow({ isSessionOpen: true, actions });

      expect(screen.queryByRole("button", { name: "Close chat" })).toBeNull();
      fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "Close chat" }));

      expect(actions.onCloseSession).toHaveBeenCalledWith("chats/plan.md");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("offers no Close chat when the chat has no live session for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({
        isSessionOpen: false,
        status: "unread",
        actions: inertChatActions({
          onCloseSession: jest.fn(async () => {}),
          getChatBookmarkState: () => new Promise<never>(() => {}),
        }),
      });

      expect(within(openRowMenu()).queryByRole("menuitem", { name: "Close chat" })).toBeNull();
      expect(screen.queryByLabelText("Session open")).toBeNull();
    });

    it("labels a pinned chat with the name of its project for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderRow({ projectName: "Garden plans" });

      expect(screen.getByLabelText("Project: Garden plans")).toBeTruthy();
    });

    it("offers the landing shelf's chat actions from the row menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderRow();

      const items = within(openRowMenu())
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent);

      expect(items).toEqual(
        expect.arrayContaining(["Pin chat", "Open chat note", "Rename", "Archive chat", "Delete"])
      );
    });

    it("pins an unpinned chat through the row menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({
        onSetChatPinned: jest.fn(async () => {}),
        getChatBookmarkState: () => new Promise<never>(() => {}),
      });
      renderRow({ actions });

      fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "Pin chat" }));

      expect(actions.onSetChatPinned).toHaveBeenCalledWith("chats/plan.md", true);
    });

    it("archives the chat through the row menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const actions = inertChatActions({
        onSetChatArchived: jest.fn(async () => {}),
        getChatBookmarkState: () => new Promise<never>(() => {}),
      });
      renderRow({ actions });

      fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "Archive chat" }));

      expect(actions.onSetChatArchived).toHaveBeenCalledWith("chats/plan.md", true);
    });

    it("does not select the chat when a menu item is chosen for https://github.com/Brevilabs/obsidian-copilot-private/issues/693", () => {
      const { onSelect } = renderRow();

      fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "Open chat note" }));

      expect(onSelect).not.toHaveBeenCalled();
    });

    it("opens the row menu from the context menu gesture", () => {
      renderRow();

      fireEvent.contextMenu(screen.getByRole("button", { name: "Plan the fall launch" }));

      expect(screen.getByRole("menu")).toBeTruthy();
    });
  });

  describe("resolveSessionStatus()", () => {
    it.each([
      [{ waiting: true, unread: true, running: true }, "waiting"],
      [{ waiting: false, unread: true, running: true }, "running"],
      [{ waiting: false, unread: true, running: false }, "unread"],
      [{ waiting: false, unread: false, running: false }, "idle"],
    ] as const)("resolves %j to %s so the most urgent status wins", (flags, expected) => {
      expect(resolveSessionStatus(flags)).toBe(expected);
    });
  });

  describe("mostUrgentStatus()", () => {
    it.each([
      [["running", "unread", "idle"], "unread"],
      [["running", "waiting", "unread"], "waiting"],
      [["idle", "running"], "running"],
      [["idle", "idle"], "idle"],
      [[], "idle"],
    ] as const)(
      "picks the most urgent of %j (waiting > unread > running) for https://github.com/Brevilabs/obsidian-copilot-private/issues/802",
      (statuses, expected) => {
        expect(mostUrgentStatus(statuses)).toBe(expected);
      }
    );
  });
});
