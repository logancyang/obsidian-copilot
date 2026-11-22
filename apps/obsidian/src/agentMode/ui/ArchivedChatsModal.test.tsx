jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));

import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import {
  ArchivedChatsList,
  ArchivedChatsModal,
  createProjectArchiveActions,
} from "@/agentMode/ui/ArchivedChatsModal";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { ReactModal } from "@/components/modals/ReactModal";
import type { ProjectConfig } from "@/aiParams";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App, Notice } from "obsidian";
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
  archivedProject("proj-old", "Thesis", new Date(2026, 8, 5, 12).getTime()),
  archivedProject("proj-new", "Launch plan", new Date(2026, 9, 20, 12).getTime()),
];

const CHATS = [
  archivedChat("chats/old.md", "Old research", new Date(2026, 7, 28, 12).getTime()),
  archivedChat("chats/new.md", "Newly shelved", new Date(2026, 9, 31, 12).getTime()),
];

const rowOf = (title: string) => screen.getByText(title).closest<HTMLElement>("[role=button]")!;

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

      expect(screen.getByText("Nothing archived")).toBeTruthy();
    });

    it("lists archived projects before archived chats, each group most recently archived first", () => {
      renderList({ projects: PROJECTS });

      expect(rowTitles()).toEqual(["Launch plan", "Thesis", "Newly shelved", "Old research"]);
    });

    it("shows the full date each project was archived", () => {
      renderList({ projects: PROJECTS });

      expect(within(rowOf("Launch plan")).getByText("October 20, 2026")).toBeTruthy();
      expect(within(rowOf("Thesis")).getByText("September 5, 2026")).toBeTruthy();
    });

    it("unarchives the project whose Unarchive icon button is clicked, drops only that project, and does not open it", async () => {
      const { onUnarchive, onUnarchiveProject, onOpenProject } = renderList({
        projects: PROJECTS,
      });

      await act(async () => {
        fireEvent.click(within(rowOf("Thesis")).getByRole("button", { name: "Unarchive" }));
      });

      expect(onUnarchiveProject).toHaveBeenCalledWith("proj-old");
      expect(onUnarchive).not.toHaveBeenCalled();
      expect(onOpenProject).not.toHaveBeenCalled();
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

    it("opens a project when its row is clicked", () => {
      const { onOpenProject, onOpen } = renderList({ projects: PROJECTS });

      fireEvent.click(screen.getByText("Launch plan"));

      expect(onOpenProject).toHaveBeenCalledWith("proj-new");
      expect(onOpen).not.toHaveBeenCalled();
    });

    it.each(["Enter", " "])("opens a project when its focused row receives %j", (key) => {
      const { onOpenProject } = renderList({ projects: PROJECTS });

      fireEvent.keyDown(rowOf("Thesis"), { key });

      expect(onOpenProject).toHaveBeenCalledWith("proj-old");
    });
  });

  describe("createProjectArchiveActions()", () => {
    const manager = { enterProject: jest.fn(async () => {}) };
    const actions = createProjectArchiveActions(
      new App(),
      manager as unknown as AgentSessionManager
    );

    it("unarchives a project through the project file manager", async () => {
      const setProjectArchived = jest.fn(async () => {});
      jest.mocked(ProjectFileManager.getInstance).mockReturnValue({
        setProjectArchived,
      } as unknown as ProjectFileManager);

      await actions.onUnarchiveProject("proj-old");

      expect(setProjectArchived).toHaveBeenCalledWith("proj-old", false);
    });

    it("tells the user and rethrows when unarchiving a project fails", async () => {
      jest.mocked(ProjectFileManager.getInstance).mockReturnValue({
        setProjectArchived: jest.fn().mockRejectedValue(new Error("disk full")),
      } as unknown as ProjectFileManager);

      await expect(actions.onUnarchiveProject("proj-old")).rejects.toThrow("disk full");
      expect(Notice).toHaveBeenCalledWith("Failed to unarchive project.");
    });

    it("opens a project by entering it in the session manager", async () => {
      await actions.onOpenProject("proj-old");

      expect(manager.enterProject).toHaveBeenCalledWith("proj-old");
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

      it("opens the clicked chat and closes the dialog", async () => {
        const onOpen = jest.fn(async () => {});
        const modal = await openModal({ onOpen });
        const close = jest.spyOn(modal, "close");

        await act(async () => {
          fireEvent.click(within(modal.contentEl).getByText("Newly shelved"));
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
          fireEvent.click(within(modal.contentEl).getByText("Thesis"));
        });

        expect(onOpenProject).toHaveBeenCalledWith("proj-old");
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});
