import { ArchivedChatsList, ArchivedChatsModal } from "@/agentMode/ui/ArchivedChatsModal";
import { ReactModal } from "@/components/modals/ReactModal";
import type { ProjectConfig } from "@/aiParams";
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

const archivedProject = (id: string, name: string, archivedAt: number): ProjectConfig => ({
  id,
  name,
  systemPrompt: "",
  contextSource: {},
  created: 1_000,
  UsageTimestamps: 2_000,
  archivedAt,
});

const PROJECTS = [
  archivedProject("proj-old", "Thesis", 2_000),
  archivedProject("proj-new", "Launch plan", 4_000),
];

const CHATS = [
  archivedChat("chats/old.md", "Old research", 1_000),
  archivedChat("chats/new.md", "Newly shelved", 3_000),
];

function renderList(overrides: Partial<React.ComponentProps<typeof ArchivedChatsList>> = {}) {
  const props = {
    items: CHATS,
    projects: [] as ProjectConfig[],
    onUnarchive: jest.fn(async () => {}),
    onOpen: jest.fn(async () => {}),
    onUnarchiveProject: jest.fn(async () => {}),
    onOpenProject: jest.fn(async () => {}),
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
    it("explains that nothing is archived when there are no archived chats or projects", () => {
      renderList({ items: [] });

      expect(screen.getByText("Nothing archived")).toBeTruthy();
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

      expect(screen.getByText("Nothing archived")).toBeTruthy();
    });

    it("lists archived projects before archived chats, each group most recently archived first", () => {
      renderList({ projects: PROJECTS });

      expect(rowTitles()).toEqual(["Launch plan", "Thesis", "Newly shelved", "Old research"]);
    });

    it("unarchives the project whose Unarchive button is clicked and drops only that project", async () => {
      const { onUnarchive, onUnarchiveProject } = renderList({ projects: PROJECTS });

      await act(async () => {
        fireEvent.click(
          within(screen.getByText("Thesis").closest("li")!).getByRole("button", {
            name: "Unarchive",
          })
        );
      });

      expect(onUnarchiveProject).toHaveBeenCalledWith("proj-old");
      expect(onUnarchive).not.toHaveBeenCalled();
      expect(rowTitles()).toEqual(["Launch plan", "Newly shelved", "Old research"]);
    });

    it("keeps a project listed when unarchiving it fails", async () => {
      const onUnarchiveProject = jest.fn(async () => {
        throw new Error("project file not found");
      });
      renderList({ items: [], projects: [PROJECTS[0]], onUnarchiveProject });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
      });

      expect(rowTitles()).toEqual(["Thesis"]);
    });

    it("opens the project whose Open button is clicked", () => {
      const { onOpenProject, onOpen } = renderList({ projects: PROJECTS });

      fireEvent.click(
        within(screen.getByText("Launch plan").closest("li")!).getByRole("button", {
          name: "Open",
        })
      );

      expect(onOpenProject).toHaveBeenCalledWith("proj-new");
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  describe("ArchivedChatsModal", () => {
    afterEach(() => document.body.replaceChildren());

    const noopActions = {
      onUnarchive: jest.fn(),
      onOpen: jest.fn(),
      onUnarchiveProject: jest.fn(),
      onOpenProject: jest.fn(),
    };

    async function openModal(actions: Partial<typeof noopActions> = {}) {
      const modal = new ArchivedChatsModal(new App(), CHATS, PROJECTS, {
        ...noopActions,
        ...actions,
      });
      modal.contentEl.empty = () => modal.contentEl.replaceChildren();
      document.body.appendChild(modal.containerEl);
      await act(async () => ReactModal.prototype.onOpen.call(modal));
      return modal;
    }

    describe("constructor()", () => {
      it("titles the native dialog Archived", () => {
        const modal = new ArchivedChatsModal(new App(), CHATS, PROJECTS, noopActions);

        expect(modal.titleEl.textContent).toBe("Archived");
      });
    });

    describe("onOpen()", () => {
      it("lists the archived projects and chats it was given", async () => {
        const modal = await openModal();

        expect(within(modal.contentEl).getAllByRole("listitem")).toHaveLength(4);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });

      it("opens the chosen chat and closes the dialog", async () => {
        const onOpen = jest.fn(async () => {});
        const modal = await openModal({ onOpen });
        const close = jest.spyOn(modal, "close");

        await act(async () => {
          fireEvent.click(
            within(within(modal.contentEl).getByText("Newly shelved").closest("li")!).getByRole(
              "button",
              { name: "Open" }
            )
          );
        });

        expect(onOpen).toHaveBeenCalledWith("chats/new.md");
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });

      it("opens the chosen project and closes the dialog", async () => {
        const onOpenProject = jest.fn(async () => {});
        const modal = await openModal({ onOpenProject });
        const close = jest.spyOn(modal, "close");

        await act(async () => {
          fireEvent.click(
            within(within(modal.contentEl).getByText("Thesis").closest("li")!).getByRole("button", {
              name: "Open",
            })
          );
        });

        expect(onOpenProject).toHaveBeenCalledWith("proj-old");
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});
