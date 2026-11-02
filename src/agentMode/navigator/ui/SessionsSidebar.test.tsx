import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { SessionsSidebar } from "@/agentMode/navigator/ui/SessionsSidebar";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import * as projectsState from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/logger");

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
  getChatHistoryItems = jest.fn(async () => this.items);
  closeChatSession = jest.fn(async (_id: string) => {});
  getOpenChatIds = () => this.open;
  getRunningChatIds = () => this.running;
  getWaitingChatIds = () => this.waiting;
  getAttentionChatIds = () => this.attention;
  getActiveChatIds = () => this.active;
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

function renderSidebar(manager: FakeManager) {
  const plugin = {
    app: { metadataCache },
    loadChatById: jest.fn(async () => {}),
    activateAgentView: jest.fn(async () => {
      manager.events.push("view");
      return null;
    }),
  };
  render(
    <SessionsSidebar
      manager={manager as unknown as AgentSessionManager}
      plugin={plugin as unknown as CopilotPlugin}
    />
  );
  return plugin;
}

function rowTitles(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("button")
    .map((row) => row.textContent!.trim());
}

describe("SessionsSidebar", () => {
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

    it("lands on a new global chat in the Agent view after the view is revealed for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const manager = new FakeManager();
      manager.items = [chat("a.md", "Alpha", 1_000)];
      renderSidebar(manager);
      await screen.findByRole("button", { name: "Alpha" });

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));

      await waitFor(() => expect(manager.openGlobalLanding).toHaveBeenCalledTimes(1));
      expect(manager.events).toEqual(["view", "landing"]);
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
