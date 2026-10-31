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
  archivedChat("chats/old.md", "Old research", 1_000),
  archivedChat("chats/new.md", "Newly shelved", 3_000),
];

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

    it("opens the chat whose Open button is clicked", () => {
      const { onOpen } = renderList();

      fireEvent.click(
        within(screen.getByText("Old research").closest("li")!).getByRole("button", {
          name: "Open",
        })
      );

      expect(onOpen).toHaveBeenCalledWith("chats/old.md");
    });

    it("unarchives the chat whose Unarchive button is clicked and drops it from the list", async () => {
      const { onUnarchive } = renderList();

      await act(async () => {
        fireEvent.click(
          within(screen.getByText("Old research").closest("li")!).getByRole("button", {
            name: "Unarchive",
          })
        );
      });

      expect(onUnarchive).toHaveBeenCalledWith("chats/old.md");
      expect(rowTitles()).toEqual(["Newly shelved"]);
    });

    it("keeps a chat listed when unarchiving it fails", async () => {
      const onUnarchive = jest.fn(async () => {
        throw new Error("note not found");
      });
      renderList({ onUnarchive });

      await act(async () => {
        fireEvent.click(
          within(screen.getByText("Old research").closest("li")!).getByRole("button", {
            name: "Unarchive",
          })
        );
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

      it("opens the chosen chat and closes the dialog", async () => {
        const onOpen = jest.fn(async () => {});
        const modal = await openModal({ onUnarchive: jest.fn(), onOpen });
        const close = jest.spyOn(modal, "close");

        await act(async () => {
          fireEvent.click(within(modal.contentEl).getAllByRole("button", { name: "Open" })[0]);
        });

        expect(onOpen).toHaveBeenCalledWith("chats/new.md");
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});
