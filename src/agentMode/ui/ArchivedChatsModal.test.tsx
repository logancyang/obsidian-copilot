import { ArchivedChatsList, ArchivedChatsModal } from "@/agentMode/ui/ArchivedChatsModal";
import { ReactModal } from "@/components/modals/ReactModal";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const archivedChat = (id: string, title: string, archivedAt: number): ChatHistoryItem => ({
  id,
  title,
  createdAt: new Date(1_000),
  lastAccessedAt: new Date(2_000),
  archivedAt,
});

const CHATS = [
  archivedChat("chats/old.md", "Old research", new Date(2026, 7, 28, 12).getTime()),
  archivedChat("chats/new.md", "Newly shelved", new Date(2026, 9, 31, 12).getTime()),
];

const rowOf = (title: string) => screen.getByText(title).closest<HTMLElement>("[role=button]")!;

function renderList(overrides: Partial<React.ComponentProps<typeof ArchivedChatsList>> = {}) {
  const props = {
    items: CHATS,
    onUnarchive: jest.fn(async () => {}),
    onOpen: jest.fn(async () => {}),
    ...overrides,
  };
  render(<ArchivedChatsList {...props} />);
  return props;
}

function rowTitles(): string[] {
  return screen.getAllByRole("listitem").map((row) => row.querySelector("[title]")!.textContent!);
}

describe("ArchivedChatsModal", () => {
  describe("ArchivedChatsList()", () => {
    it("explains that nothing is archived when there are no archived chats", () => {
      renderList({ items: [] });

      expect(screen.getByText("No archived chats")).toBeTruthy();
      expect(screen.queryByRole("listitem")).toBeNull();
    });

    it("lists every archived chat by title, most recently archived first", () => {
      renderList();

      expect(rowTitles()).toEqual(["Newly shelved", "Old research"]);
    });

    it("shows the full date each chat was archived", () => {
      renderList();

      expect(within(rowOf("Newly shelved")).getByText("October 31, 2026")).toBeTruthy();
      expect(within(rowOf("Old research")).getByText("August 28, 2026")).toBeTruthy();
    });

    it("opens a chat when its row is clicked", () => {
      const { onOpen } = renderList();

      fireEvent.click(screen.getByText("Old research"));

      expect(onOpen).toHaveBeenCalledWith("chats/old.md");
    });

    it.each(["Enter", " "])("opens a chat when its focused row receives %j", (key) => {
      const { onOpen } = renderList();

      fireEvent.keyDown(rowOf("Old research"), { key });

      expect(onOpen).toHaveBeenCalledWith("chats/old.md");
    });

    it("offers no Open button because the row itself opens the chat", () => {
      renderList();

      expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    });

    it("hides the unarchive icon button until the row is hovered or focused while keeping it focusable", () => {
      renderList();

      const unarchive = within(rowOf("Old research")).getByRole("button", { name: "Unarchive" });

      expect(unarchive.parentElement!.className).toContain("tw-opacity-0");
      expect(unarchive.parentElement!.className).toContain("focus-within:tw-opacity-100");
      expect(unarchive.parentElement!.className).toContain("group-hover:tw-opacity-100");
      expect(unarchive.getAttribute("title")).toBe("Unarchive");
      expect(unarchive.textContent).toBe("");
    });

    it("unarchives the chat whose Unarchive icon button is clicked, drops it from the list, and does not open it", async () => {
      const { onUnarchive, onOpen } = renderList();

      await act(async () => {
        fireEvent.click(within(rowOf("Old research")).getByRole("button", { name: "Unarchive" }));
      });

      expect(onUnarchive).toHaveBeenCalledWith("chats/old.md");
      expect(onOpen).not.toHaveBeenCalled();
      expect(rowTitles()).toEqual(["Newly shelved"]);
    });

    it("keeps a chat listed when unarchiving it fails", async () => {
      const onUnarchive = jest.fn(async () => {
        throw new Error("note not found");
      });
      renderList({ onUnarchive });

      await act(async () => {
        fireEvent.click(within(rowOf("Old research")).getByRole("button", { name: "Unarchive" }));
      });

      expect(rowTitles()).toEqual(["Newly shelved", "Old research"]);
    });

    it("shows the empty message after the last chat is unarchived", async () => {
      renderList({ items: [CHATS[0]] });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
      });

      expect(screen.getByText("No archived chats")).toBeTruthy();
    });
  });

  describe("ArchivedChatsModal", () => {
    afterEach(() => document.body.replaceChildren());

    async function openModal(actions: {
      onUnarchive: (id: string) => Promise<void>;
      onOpen: (id: string) => Promise<void>;
    }) {
      const modal = new ArchivedChatsModal(new App(), CHATS, actions);
      modal.contentEl.empty = () => modal.contentEl.replaceChildren();
      document.body.appendChild(modal.containerEl);
      await act(async () => ReactModal.prototype.onOpen.call(modal));
      return modal;
    }

    describe("constructor()", () => {
      it("titles the native dialog Archived", () => {
        const modal = new ArchivedChatsModal(new App(), CHATS, {
          onUnarchive: jest.fn(),
          onOpen: jest.fn(),
        });

        expect(modal.titleEl.textContent).toBe("Archived");
      });
    });

    describe("onOpen()", () => {
      it("lists the archived chats it was given", async () => {
        const modal = await openModal({ onUnarchive: jest.fn(), onOpen: jest.fn() });

        expect(within(modal.contentEl).getAllByRole("listitem")).toHaveLength(2);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });

      it("opens the clicked chat and closes the dialog", async () => {
        const onOpen = jest.fn(async () => {});
        const modal = await openModal({ onUnarchive: jest.fn(), onOpen });
        const close = jest.spyOn(modal, "close");

        await act(async () => {
          fireEvent.click(within(modal.contentEl).getByText("Newly shelved"));
        });

        expect(onOpen).toHaveBeenCalledWith("chats/new.md");
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});
