import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { SessionsSidebar } from "@/agentMode/ui/SessionsSidebar";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import * as projectsState from "@/projects/state";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { dragByKeyboard, stackRowsVertically } from "@/agentMode/ui/testing/keyboardDrag";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { ArchivedChatsModal } from "@/agentMode/ui/ArchivedChatsModal";
import type { ProjectFileRecord } from "@/projects/type";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppContext } from "@/context";
import { type App, Notice } from "obsidian";
import React from "react";

jest.mock("@/logger");
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));
const mockDeleteConfirmations: (() => Promise<void> | void)[] = [];
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, onConfirm) => {
    mockDeleteConfirmations.push(onConfirm);
    return { open: jest.fn() };
  }),
}));
jest.mock("@/agentMode/ui/ArchivedChatsModal", () => ({
  ...jest.requireActual("@/agentMode/ui/ArchivedChatsModal"),
  ArchivedChatsModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

const NONE: ReadonlySet<string> = new Set();

function chat(id: string, title: string, createdMs: number, extra: Partial<ChatHistoryItem> = {}) {
  return {
    id,
    title,
    createdAt: new Date(createdMs),
    lastAccessedAt: new Date(createdMs),
    ...extra,
  } satisfies ChatHistoryItem;
}

class FakeManager {
  items: ChatHistoryItem[] = [];
  open = NONE;
  running = NONE;
  waiting = NONE;
  attention = NONE;
  active = NONE;
  readonly listeners = new Set<() => void>();
  readonly events: string[] = [];
  openGlobalLanding = jest.fn(async () => {
    this.events.push("landing");
  });
  openProjectLanding = jest.fn(async (projectId: string) => {
    this.events.push(`landing:${projectId}`);
  });
  getChatHistoryItems = jest.fn(async () => this.items);
  closeChatSession = jest.fn(async (_id: string) => {});
  getOpenChatIds = () => this.open;
  getRunningChatIds = () => this.running;
  getWaitingChatIds = () => this.waiting;
  getAttentionChatIds = () => this.attention;
  getActiveChatIds = () => this.active;
  activeProjectId = "";
  setChatPinned = jest.fn(async (id: string, pinned: boolean) => ({
    id,
    pinnedAt: pinned ? 9_000 : undefined,
  }));
  setChatArchived = jest.fn(async (id: string, archived: boolean) => ({
    id,
    archivedAt: archived ? 9_000 : undefined,
  }));
  updateChatTitle = jest.fn(async () => {});
  getActiveProjectId = () => this.activeProjectId;
  exitProject = jest.fn(async () => {});
  enterProject = jest.fn(async (projectId: string) => {
    this.events.push(`enter:${projectId}`);
    this.activeProjectId = projectId;
    this.emit();
  });
  historyRevision = 0;
  getHistoryRevision = () => this.historyRevision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeMetadataCache {
  private readonly handlers = new Set<(...args: unknown[]) => void>();
  on = (_name: "changed", handler: (...args: unknown[]) => void) => {
    this.handlers.add(handler);
    return handler;
  };
  offref = (ref: (...args: unknown[]) => void) => {
    this.handlers.delete(ref);
  };
  change(frontmatter: Record<string, unknown> | undefined): void {
    for (const handler of this.handlers) handler({ path: "note.md" }, "", { frontmatter });
  }
}

const metadataCache = new FakeMetadataCache();

class FakeLocalStorage {
  readonly store = new Map<string, unknown>();
  loadLocalStorage = (key: string) => this.store.get(key) ?? null;
  saveLocalStorage = (key: string, value: unknown) => void this.store.set(key, value);
}

const createProject = jest.fn(async (project: { id: string; name: string }) => {
  projectsState.updateCachedProjectRecords([
    ...projectsState.getCachedProjectRecords(),
    projectRecord(project.id, project.name),
  ]);
});

function renderSidebar(manager: FakeManager, localStorage = new FakeLocalStorage()) {
  jest.mocked(ProjectFileManager.getInstance).mockReturnValue({
    deleteProject: jest.fn(async () => {}),
    createProject,
  } as unknown as ProjectFileManager);
  const plugin = {
    app: {
      metadataCache,
      loadLocalStorage: localStorage.loadLocalStorage,
      saveLocalStorage: localStorage.saveLocalStorage,
    },
    openChatSourceFile: jest.fn(async () => {}),
    loadChatById: jest.fn(async () => {}),
    activateAgentView: jest.fn(async () => {
      manager.events.push("view");
      return null;
    }),
  };
  render(
    <AppContext.Provider value={plugin.app as unknown as App}>
      <SessionsSidebar
        manager={manager as unknown as AgentSessionManager}
        plugin={plugin as unknown as CopilotPlugin}
      />
    </AppContext.Provider>
  );
  return plugin;
}

function rowTitles(): string[] {
  return screen
    .queryAllByRole("button")
    .filter(
      (button) => !button.hasAttribute("aria-expanded") && !button.hasAttribute("aria-pressed")
    )
    .filter(
      (button) =>
        !/^(New chat|New project|Search chats|Sidebar options|More actions|Show more)/.test(
          button.getAttribute("aria-label") ?? button.textContent ?? ""
        )
    )
    .map((row) => row.textContent!.trim());
}

function preExpanded(...projectIds: string[]): FakeLocalStorage {
  const storage = new FakeLocalStorage();
  storage.saveLocalStorage(
    "copilot:sessions-sidebar-expanded-projects:v1",
    JSON.stringify(projectIds)
  );
  return storage;
}

function openMenuIn(row: HTMLElement): void {
  fireEvent.pointerDown(within(row).getByRole("button", { name: /^More actions/ }), {
    button: 0,
    ctrlKey: false,
  });
}

function projectRecord(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    project: { id, name, created: 1_000, UsageTimestamps: 0, ...extra },
    filePath: `Projects/${id}/project.md`,
    folderName: id,
  } as unknown as ProjectFileRecord;
}

describe("SessionsSidebar", () => {
  beforeAll(() => {
    installRadixMenuPolyfills();
    const cryptoObj = window.crypto as { randomUUID?: () => string };
    if (typeof cryptoObj.randomUUID !== "function") {
      let counter = 0;
      cryptoObj.randomUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
    }
  });

  describe("SessionsSidebar()", () => {
    afterEach(() => {
      cleanup();
      projectsState.updateCachedProjectRecords([]);
      jest.clearAllMocks();
    });

    it("lists the saved chats the manager reports, newest first, once history loads for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Older", 1_000), chat("b.md", "Newer", 2_000)];

      renderSidebar(manager);

      await waitFor(() => expect(rowTitles()).toEqual(["Newer", "Older"]));
    });

    it("leaves archived chats out of the list for https://github.com/Brevilabs/obsidian-copilot-private/issues/805", async () => {
      const manager = new FakeManager();
      manager.items = [
        chat("live.md", "Live chat", 2_000),
        chat("shelved.md", "Shelved chat", 3_000, { archivedAt: 4_000 }),
      ];

      renderSidebar(manager);

      await waitFor(() => expect(rowTitles()).toEqual(["Live chat"]));
    });

    it("opens the clicked chat through the plugin, which also reveals the Agent view for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("chats/a.md", "Alpha", 1_000)];
      const plugin = renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "Alpha" }));

      await waitFor(() => expect(plugin.loadChatById).toHaveBeenCalledWith("chats/a.md"));
    });

    it("tells the user when the chat cannot be opened for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("chats/a.md", "Alpha", 1_000)];
      const plugin = renderSidebar(manager);
      plugin.loadChatById.mockRejectedValueOnce(new Error("Chat file not found."));

      fireEvent.click(await screen.findByRole("button", { name: "Alpha" }));

      await waitFor(() => expect(Notice).toHaveBeenCalledWith("Failed to load chat."));
    });

    it("highlights the row of the active chat and follows the manager when another chat becomes active for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 2_000), chat("b.md", "Beta", 1_000)];
      manager.active = new Set(["a.md"]);
      renderSidebar(manager);
      const current = () =>
        screen
          .getAllByRole("button")
          .filter((row) => row.getAttribute("aria-current") === "true")
          .map((row) => row.textContent!.trim());
      await waitFor(() => expect(current()).toEqual(["Alpha"]));

      manager.active = new Set(["b.md"]);
      act(() => manager.emit());

      await waitFor(() => expect(current()).toEqual(["Beta"]));
    });

    it("shows running, waiting, and unread statuses reported by the manager for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [
        chat("run.md", "Runner", 4_000),
        chat("wait.md", "Waiter", 3_000),
        chat("read.md", "Reader", 2_000),
        chat("idle.md", "Idler", 1_000),
      ];
      manager.running = new Set(["run.md"]);
      manager.waiting = new Set(["wait.md"]);
      manager.attention = new Set(["read.md"]);

      renderSidebar(manager);

      const row = (name: RegExp) => screen.findByRole("button", { name });
      expect(within(await row(/Runner/)).getByLabelText("Running")).toBeTruthy();
      expect(within(await row(/Waiter/)).getByLabelText("Waiting for permission")).toBeTruthy();
      expect(within(await row(/Reader/)).getByLabelText("Unread result")).toBeTruthy();
      expect(within(await row(/Idler/)).queryByRole("img")).toBeNull();
    });

    it("closes a chat's live session from its row through the manager for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      manager.open = new Set(["a.md"]);
      renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "Close chat" }));

      await waitFor(() => expect(manager.closeChatSession).toHaveBeenCalledWith("a.md"));
    });

    it("tells the user when a chat's live session cannot be closed for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      manager.open = new Set(["a.md"]);
      manager.closeChatSession.mockRejectedValueOnce(new Error("Agent is busy."));
      renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "Close chat" }));

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Could not close chat: Agent is busy.")
      );
    });

    it("reveals the Agent view once the new global chat is open, so its composer takes the focus for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));

      await waitFor(() => expect(manager.openGlobalLanding).toHaveBeenCalledTimes(1));
      expect(manager.events).toEqual(["landing", "view"]);
    });

    it("reports a failed new chat without throwing for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      const failure = new Error("spawn failed");
      manager.openGlobalLanding.mockRejectedValueOnce(failure);
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));

      await waitFor(() =>
        expect(logError).toHaveBeenCalledWith("[AgentMode] sidebar new chat failed", failure)
      );
      expect(Notice).toHaveBeenCalledWith("Failed to start a new chat. Please try again.");
    });

    it("reloads the list when a chat opens or finishes so new chats appear for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(1);

      manager.items = [chat("a.md", "Alpha", 1_000), chat("b.md", "Beta", 2_000)];
      manager.open = new Set(["b.md"]);
      act(() => manager.emit());
      await screen.findByRole("button", { name: /^Beta Session open$/ });

      manager.items = [chat("a.md", "Alpha", 1_000), chat("b.md", "Beta finished", 2_000)];
      manager.running = new Set(["b.md"]);
      act(() => manager.emit());
      await screen.findByRole("button", { name: /Beta finished/ });
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(3);
    });

    it("does not reload the list for manager updates that change no open or running chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      act(() => manager.emit());
      act(() => manager.emit());

      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(1);
    });

    it("reloads the list when a chat is deleted from another list so the row drops out for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000), chat("b.md", "Beta", 2_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      manager.items = [chat("b.md", "Beta", 2_000)];
      manager.historyRevision++;
      act(() => manager.emit());

      await waitFor(() => expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull());
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(2);
    });

    it("reloads the list when an agent chat note's frontmatter changes so an archive from another list drops the row for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000), chat("b.md", "Beta", 2_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      manager.items = [
        chat("a.md", "Alpha", 1_000, { archivedAt: 5_000 }),
        chat("b.md", "Beta", 2_000),
      ];
      act(() => metadataCache.change({ mode: "agent", archivedAt: 5_000 }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull());
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(2);
    });

    it("ignores metadata changes of notes that are not agent chats for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      act(() => metadataCache.change(undefined));
      act(() => metadataCache.change({ tags: ["daily"] }));

      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(1);
    });

    it("groups saved chats into Projects and Recents and keeps the open folders across a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      manager.items = [
        chat("a.md", "Loose chat", 1_000),
        chat("b.md", "Seedling notes", 2_000, { projectId: "garden" }),
      ];
      const storage = new FakeLocalStorage();
      renderSidebar(manager, storage);
      await screen.findByRole("button", { name: "Loose chat" });
      expect(screen.queryByRole("button", { name: "Seedling notes" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Garden plans" }));
      expect(screen.getByRole("button", { name: "Seedling notes" })).toBeTruthy();

      cleanup();
      renderSidebar(manager, storage);
      expect(await screen.findByRole("button", { name: "Seedling notes" })).toBeTruthy();
    });

    it("keeps a folded group folded after a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Loose chat", 1_000)];
      const storage = new FakeLocalStorage();
      renderSidebar(manager, storage);
      await screen.findByRole("button", { name: "Loose chat" });

      fireEvent.click(screen.getByRole("button", { name: "Recents" }));
      expect(screen.queryByRole("button", { name: "Loose chat" })).toBeNull();

      cleanup();
      renderSidebar(manager, storage);
      const header = await screen.findByRole("button", { name: "Recents" });
      expect(header.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: "Loose chat" })).toBeNull();
    });

    it("orders projects newest created first, ignoring recent use, and leaves archived projects out for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([
        projectRecord("stale", "Stale project", { created: 1_000, UsageTimestamps: 9_000 }),
        projectRecord("fresh", "Fresh project", { created: 5_000, UsageTimestamps: 1_000 }),
        projectRecord("shelved", "Shelved project", { created: 9_000, archivedAt: 9_500 }),
      ]);
      renderSidebar(new FakeManager());

      const folders = await screen.findAllByRole("button", {
        expanded: false,
        name: /^\w+ project$/,
      });

      expect(folders.map((folder) => folder.textContent)).toEqual([
        "Fresh project",
        "Stale project",
      ]);
    });

    it("keeps a dragged project order across a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/811", async () => {
      projectsState.updateCachedProjectRecords([
        projectRecord("older", "Older project", { created: 1_000 }),
        projectRecord("newer", "Newer project", { created: 5_000 }),
      ]);
      const storage = new FakeLocalStorage();
      renderSidebar(new FakeManager(), storage);
      const [newer] = await screen.findAllByRole("button", {
        expanded: false,
        name: /^\w+ project$/,
      });
      jest.useFakeTimers();
      const layout = stackRowsVertically();
      try {
        dragByKeyboard(newer, "ArrowDown", 1);
      } finally {
        jest.useRealTimers();
        layout.mockRestore();
      }
      cleanup();
      renderSidebar(new FakeManager(), storage);

      const folders = await screen.findAllByRole("button", {
        expanded: false,
        name: /^\w+ project$/,
      });
      expect(folders.map((folder) => folder.textContent)).toEqual([
        "Older project",
        "Newer project",
      ]);
    });

    it("moves a chat pinned from its row menu into Pinned for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      manager.items = [chat("b.md", "Seedling notes", 2_000, { projectId: "garden" })];
      renderSidebar(manager, preExpanded("garden"));
      const row = (await screen.findByRole("button", { name: "Seedling notes" })).parentElement!;

      openMenuIn(row);
      fireEvent.click(screen.getByRole("menuitem", { name: "Pin chat" }));

      const pinned = await screen.findByRole("region", { name: "Pinned" });
      expect(manager.setChatPinned).toHaveBeenCalledWith("b.md", true, undefined);
      expect(within(pinned).getByText("Seedling notes")).toBeTruthy();
      expect(screen.getAllByText("Seedling notes")).toHaveLength(1);
    });

    it("archives a chat from its row menu so the row disappears for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Loose chat", 1_000)];
      renderSidebar(manager);
      const row = (await screen.findByRole("button", { name: "Loose chat" })).parentElement!;

      openMenuIn(row);
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive chat" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "Loose chat" })).toBeNull());
      expect(manager.setChatArchived).toHaveBeenCalledWith("a.md", true);
    });

    it("opens a note-backed chat's note from its row menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Loose chat", 1_000)];
      const plugin = renderSidebar(manager);
      const row = (await screen.findByRole("button", { name: "Loose chat" })).parentElement!;

      openMenuIn(row);
      fireEvent.click(screen.getByRole("menuitem", { name: "Open chat note" }));

      await waitFor(() => expect(plugin.openChatSourceFile).toHaveBeenCalledWith("a.md"));
    });

    it("opens the Archived dialog with the archived chats and projects from the header menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([
        projectRecord("shelved", "Shelved project", { archivedAt: 9_500 }),
      ]);
      const manager = new FakeManager();
      manager.items = [
        chat("live.md", "Live chat", 2_000),
        chat("shelved.md", "Shelved chat", 3_000, { archivedAt: 4_000 }),
      ];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Live chat" });

      fireEvent.pointerDown(screen.getByRole("button", { name: "Sidebar options" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "View archived" }));

      const [, chats, projects] = jest.mocked(ArchivedChatsModal).mock.calls[0];
      expect(chats.map((item) => item.id)).toEqual(["shelved.md"]);
      expect(projects.map((project) => project.id)).toEqual(["shelved"]);
    });

    it("reveals the Agent view after entering a project opened from the Archived dialog for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });
      fireEvent.pointerDown(screen.getByRole("button", { name: "Sidebar options" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "View archived" }));

      const [, , , actions] = jest.mocked(ArchivedChatsModal).mock.calls[0];
      await actions.onOpenProject("shelved");

      expect(manager.events).toEqual(["enter:shelved", "view"]);
    });

    it("leaves the project when the open project is deleted from its folder menu, as the landing list does, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      manager.activeProjectId = "garden";
      renderSidebar(manager);
      const folder = (await screen.findByRole("button", { name: "Garden plans" })).parentElement!;

      openMenuIn(folder);
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));
      await mockDeleteConfirmations[0]();

      expect(manager.exitProject).toHaveBeenCalledTimes(1);
    });

    it("expands the folder from its row without opening its project, so the current chat stays for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      manager.items = [chat("b.md", "Seedling notes", 2_000, { projectId: "garden" })];
      const plugin = renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "Garden plans" }));

      expect(screen.getByRole("button", { name: "Seedling notes" })).toBeTruthy();
      expect(manager.openProjectLanding).not.toHaveBeenCalled();
      expect(plugin.activateAgentView).not.toHaveBeenCalled();
    });

    it("opens the project landing from the folder's plus without expanding the folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      manager.items = [chat("b.md", "Seedling notes", 2_000, { projectId: "garden" })];
      renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "New chat in Garden plans" }));

      await waitFor(() => expect(manager.events).toEqual(["landing:garden", "view"]));
      expect(screen.queryByRole("button", { name: "Seedling notes" })).toBeNull();
    });

    it("reports a project that cannot be opened without throwing for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      projectsState.updateCachedProjectRecords([projectRecord("garden", "Garden plans")]);
      const manager = new FakeManager();
      const failure = new Error("spawn failed");
      manager.openProjectLanding.mockRejectedValueOnce(failure);
      renderSidebar(manager);

      fireEvent.click(await screen.findByRole("button", { name: "New chat in Garden plans" }));

      await waitFor(() =>
        expect(logError).toHaveBeenCalledWith("[AgentMode] sidebar open project failed", failure)
      );
      expect(Notice).toHaveBeenCalledWith("Failed to open project. Please try again.");
    });

    it("highlights the folder of the open project landing for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      projectsState.updateCachedProjectRecords([
        projectRecord("garden", "Garden plans"),
        projectRecord("thesis", "Thesis"),
      ]);
      const manager = new FakeManager();
      manager.activeProjectId = "garden";
      renderSidebar(manager);

      expect(
        (await screen.findByRole("button", { name: "Garden plans" })).getAttribute("aria-current")
      ).toBe("true");
      expect(
        screen.getByRole("button", { name: "Thesis" }).getAttribute("aria-current")
      ).toBeNull();
    });

    it("creates a project from the new project dialog, opens its landing and selects its folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      const manager = new FakeManager();
      const plugin = renderSidebar(manager);
      await screen.findByRole("button", { name: "New project" });

      fireEvent.click(screen.getByRole("button", { name: "New project" }));
      const field = within(screen.getByRole("dialog", { name: "New project" })).getByRole(
        "textbox"
      );
      fireEvent.change(field, { target: { value: "Garden plans" } });
      await act(async () => {
        fireEvent.keyDown(field, { key: "Enter" });
      });

      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ name: "Garden plans" }));
      expect(manager.enterProject).toHaveBeenCalledWith(createProject.mock.calls[0][0].id);
      expect(plugin.activateAgentView).toHaveBeenCalledTimes(1);
      expect(manager.events[0]).toMatch(/^enter:/);
      expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull();
      expect(
        (await screen.findByRole("button", { name: "Garden plans" })).getAttribute("aria-current")
      ).toBe("true");
    });

    it("keeps the new project dialog open and reports createProject's error when the name is taken for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
      const manager = new FakeManager();
      renderSidebar(manager);
      createProject.mockRejectedValueOnce(
        new Error('A project with the name "Garden plans" already exists')
      );
      fireEvent.click(await screen.findByRole("button", { name: "New project" }));
      const field = within(screen.getByRole("dialog", { name: "New project" })).getByRole(
        "textbox"
      );
      fireEvent.change(field, { target: { value: "Garden plans" } });

      await act(async () => {
        fireEvent.keyDown(field, { key: "Enter" });
      });

      expect(Notice).toHaveBeenCalledWith('A project with the name "Garden plans" already exists');
      expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
      expect(manager.enterProject).not.toHaveBeenCalled();
    });

    it("reloads the list when a project is archived so its chats drop out for https://github.com/Brevilabs/obsidian-copilot-private/issues/806", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      manager.items = [];
      act(() =>
        projectsState.updateCachedProjectRecords([
          {
            project: { id: "proj", archivedAt: 5_000 },
            filePath: "Projects/proj/project.md",
            folderName: "proj",
          } as unknown as ProjectFileRecord,
        ])
      );

      await waitFor(() => expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull());
      expect(manager.getChatHistoryItems).toHaveBeenCalledTimes(2);
    });
  });
});
