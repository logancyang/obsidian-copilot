import { SessionsSidebarPanel } from "@/agentMode/navigator/ui/SessionsSidebarPanel";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import {
  inertChatActions,
  sidebarChat,
  sidebarProject,
} from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App, Notice } from "obsidian";
import React from "react";

const NONE: ReadonlySet<string> = new Set();

function baseProps(
  overrides: Partial<React.ComponentProps<typeof SessionsSidebarPanel>> = {}
): React.ComponentProps<typeof SessionsSidebarPanel> {
  return {
    items: [],
    projects: [],
    expandedProjectIds: NONE,
    activeProjectId: "",
    activeChatIds: NONE,
    runningChatIds: NONE,
    waitingChatIds: NONE,
    attentionChatIds: NONE,
    openChatIds: NONE,
    collapsedGroups: NONE,
    onToggleGroup: jest.fn(),
    actions: inertChatActions({ getChatBookmarkState: () => new Promise<never>(() => {}) }),
    onNewChat: jest.fn(),
    onOpenChat: jest.fn(),
    onToggleProject: jest.fn(),
    onOpenProject: jest.fn(),
    onCreateProject: jest.fn().mockResolvedValue(undefined),
    onProjectDeleted: jest.fn(),
    onViewArchived: jest.fn(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof SessionsSidebarPanel>> = {}) {
  const props = baseProps(overrides);
  render(
    <AppContext.Provider value={new App()}>
      <SessionsSidebarPanel {...props} />
    </AppContext.Provider>
  );
  return props;
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function chatTitles(root: HTMLElement): string[] {
  return within(root)
    .queryAllByRole("button")
    .filter(
      (button) =>
        !button.hasAttribute("aria-expanded") && /^(Chat|Pin|Rec)/.test(button.textContent ?? "")
    )
    .map((button) => (button.textContent ?? "").trim());
}

function projectChats(projectId: string, count: number, extra: Partial<ChatHistoryItem> = {}) {
  return Array.from({ length: count }, (_, index) =>
    sidebarChat(`chats/${projectId}-${index}.md`, `Chat ${projectId} ${index + 1}`, index + 1, {
      projectId,
      ...extra,
    })
  );
}

function projects(count: number) {
  return Array.from({ length: count }, (_, index) =>
    sidebarProject(`p${index + 1}`, `Project ${index + 1}`)
  );
}

describe("SessionsSidebarPanel", () => {
  beforeAll(installRadixMenuPolyfills);

  describe("SessionsSidebarPanel()", () => {
    describe("grouping", () => {
      it("shows Pinned, Projects and Recents groups for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          items: [
            sidebarChat("chats/pin.md", "Pinned chat", 1, { pinnedAt: 5 }),
            sidebarChat("chats/rec.md", "Recent chat", 2),
            ...projectChats("p1", 1),
          ],
          projects: projects(1),
          expandedProjectIds: new Set(["p1"]),
        });

        expect(within(section("Pinned")).getByText("Pinned chat")).toBeTruthy();
        expect(within(section("Projects")).getByText("Project 1")).toBeTruthy();
        expect(within(section("Projects")).getByText("Chat p1 1")).toBeTruthy();
        expect(within(section("Recents")).getByText("Recent chat")).toBeTruthy();
      });

      it("omits the Pinned and Recents groups that have nothing to show but keeps Projects for its New project button", () => {
        renderPanel({ items: [sidebarChat("chats/rec.md", "Recent chat", 2)] });

        expect(screen.queryByRole("region", { name: "Pinned" })).toBeNull();
        expect(
          within(section("Projects")).getByRole("button", { name: "New project" })
        ).toBeTruthy();
        expect(screen.getByRole("region", { name: "Recents" })).toBeTruthy();
      });

      it("lists a pinned project chat only under Pinned, labelled with its project, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          items: [
            sidebarChat("chats/p1-pin.md", "Pinned project chat", 1, {
              projectId: "p1",
              pinnedAt: 5,
            }),
            ...projectChats("p1", 1),
          ],
          projects: projects(1),
          expandedProjectIds: new Set(["p1"]),
        });

        expect(within(section("Pinned")).getByText("Pinned project chat")).toBeTruthy();
        expect(within(section("Pinned")).getByLabelText("Project: Project 1")).toBeTruthy();
        expect(within(section("Projects")).queryByText("Pinned project chat")).toBeNull();
        expect(screen.getAllByText("Pinned project chat")).toHaveLength(1);
      });

      it("explains that no chats exist yet when there are no chats and no projects", () => {
        renderPanel();

        expect(screen.getByText("No chats yet")).toBeTruthy();
      });

      it("keeps a project without chats visible as a folder", () => {
        renderPanel({ projects: projects(1) });

        expect(screen.getByRole("button", { name: "Project 1" })).toBeTruthy();
        expect(screen.queryByText("No chats yet")).toBeNull();
      });

      it.each([
        ["Pinned", "pinned"],
        ["Projects", "projects"],
        ["Recents", "recents"],
      ])(
        "folds the %s group from its header for https://github.com/Brevilabs/obsidian-copilot-private/issues/802",
        (title, groupId) => {
          const { onToggleGroup } = renderPanel({
            items: [
              sidebarChat("chats/pin.md", "Pinned chat", 1, { pinnedAt: 5 }),
              sidebarChat("chats/rec.md", "Recent chat", 2),
            ],
            projects: projects(1),
          });

          const header = within(section(title)).getByRole("button", { name: title });
          expect(header.getAttribute("aria-expanded")).toBe("true");
          fireEvent.click(header);

          expect(onToggleGroup).toHaveBeenCalledWith(groupId);
        }
      );

      it("hides the rows of a folded group but keeps its header for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          items: [
            sidebarChat("chats/pin.md", "Pinned chat", 1, { pinnedAt: 5 }),
            sidebarChat("chats/rec.md", "Recent chat", 2),
          ],
          projects: projects(1),
          collapsedGroups: new Set(["pinned", "projects"]),
        });

        expect(
          within(section("Pinned"))
            .getByRole("button", { name: "Pinned" })
            .getAttribute("aria-expanded")
        ).toBe("false");
        expect(screen.queryByText("Pinned chat")).toBeNull();
        expect(screen.queryByRole("button", { name: "Project 1" })).toBeNull();
        expect(within(section("Recents")).getByText("Recent chat")).toBeTruthy();
      });
    });

    describe("projects", () => {
      it("lists the first 5 projects before Show more for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ projects: projects(7) });

        const folders = within(section("Projects"))
          .getAllByRole("button", { expanded: false, name: /^Project \d$/ })
          .map((button) => button.textContent);
        expect(folders).toEqual(["Project 1", "Project 2", "Project 3", "Project 4", "Project 5"]);
      });

      it("reveals every remaining project after Show more", () => {
        renderPanel({ projects: projects(7) });

        fireEvent.click(within(section("Projects")).getByRole("button", { name: "Show more" }));

        expect(within(section("Projects")).getByRole("button", { name: "Project 7" })).toBeTruthy();
        expect(within(section("Projects")).queryByRole("button", { name: "Show more" })).toBeNull();
      });

      it("has no Show more when 5 or fewer projects exist", () => {
        renderPanel({ projects: projects(5) });

        expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
      });

      it("only folds or unfolds a project on a click of its row, without opening the project or a chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        const { onToggleProject, onOpenProject, onOpenChat } = renderPanel({
          projects: projects(1),
          items: projectChats("p1", 2),
          expandedProjectIds: new Set(["p1"]),
        });

        fireEvent.click(screen.getByRole("button", { name: "Project 1" }));

        expect(onToggleProject).toHaveBeenCalledWith("p1");
        expect(onOpenProject).not.toHaveBeenCalled();
        expect(onOpenChat).not.toHaveBeenCalled();
      });

      it("highlights a collapsed folder whose open chat is hidden inside it for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        const items = projectChats("p1", 1);
        renderPanel({
          projects: projects(1),
          items,
          activeProjectId: "p1",
          activeChatIds: new Set([items[0].id]),
        });

        expect(screen.getByRole("button", { name: "Project 1" }).getAttribute("aria-current")).toBe(
          "true"
        );
      });

      it("starts a chat in the project from the folder's plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        const { onOpenProject, onToggleProject } = renderPanel({ projects: projects(2) });

        fireEvent.click(screen.getByRole("button", { name: "New chat in Project 2" }));

        expect(onOpenProject).toHaveBeenCalledWith("p2");
        expect(onToggleProject).not.toHaveBeenCalled();
      });

      it("highlights the folder of the open project landing but not a folder whose own chat is open for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        const items = projectChats("p1", 1);
        const { unmount } = render(
          <AppContext.Provider value={new App()}>
            <SessionsSidebarPanel
              {...baseProps({ projects: projects(2), items, activeProjectId: "p2" })}
            />
          </AppContext.Provider>
        );
        const current = () =>
          screen
            .getAllByRole("button")
            .filter((row) => row.getAttribute("aria-current") === "true")
            .map((row) => row.textContent!.trim());
        expect(current()).toEqual(["Project 2"]);
        unmount();

        renderPanel({
          projects: projects(2),
          items,
          expandedProjectIds: new Set(["p1"]),
          activeProjectId: "p1",
          activeChatIds: new Set([items[0].id]),
        });
        expect(current()).toEqual(["Chat p1 1"]);
      });

      it("says an expanded project has no chats instead of leaving an empty gap for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ projects: projects(2), expandedProjectIds: new Set(["p1"]) });

        expect(within(section("Projects")).getAllByText("No chats")).toHaveLength(1);
      });

      it("hides the chats of a collapsed project", () => {
        renderPanel({ projects: projects(1), items: projectChats("p1", 3) });

        expect(screen.queryByText("Chat p1 1")).toBeNull();
      });

      it("lists the 5 newest chats of an expanded project, then Show more for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 8),
          expandedProjectIds: new Set(["p1"]),
        });

        expect(chatTitles(section("Projects"))).toEqual([
          "Chat p1 1",
          "Chat p1 2",
          "Chat p1 3",
          "Chat p1 4",
          "Chat p1 5",
        ]);
        expect(within(section("Projects")).getByRole("button", { name: "Show more" })).toBeTruthy();
      });

      it("reveals the rest of an expanded project's chats after Show more", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 8),
          expandedProjectIds: new Set(["p1"]),
        });

        fireEvent.click(within(section("Projects")).getByRole("button", { name: "Show more" }));

        expect(chatTitles(section("Projects"))).toHaveLength(8);
      });

      it("opens the clicked project chat by its history id", () => {
        const { onOpenChat } = renderPanel({
          projects: projects(1),
          items: projectChats("p1", 2),
          expandedProjectIds: new Set(["p1"]),
        });

        fireEvent.click(screen.getByRole("button", { name: "Chat p1 2" }));

        expect(onOpenChat).toHaveBeenCalledWith("chats/p1-1.md");
      });
    });

    describe("folder status", () => {
      function folderStatus(statusLabel: string): boolean {
        const folder = screen.getByRole("button", { name: /^Project 1/ });
        return within(folder).queryByLabelText(statusLabel) !== null;
      }

      it.each([
        ["waiting", { waitingChatIds: new Set(["chats/p1-2.md"]) }, "Waiting for permission"],
        ["unread", { attentionChatIds: new Set(["chats/p1-2.md"]) }, "Unread result"],
        ["running", { runningChatIds: new Set(["chats/p1-2.md"]) }, "Running"],
      ])(
        "shows a %s chat of a collapsed project on its folder row for https://github.com/Brevilabs/obsidian-copilot-private/issues/802",
        (_status, sets, label) => {
          renderPanel({ projects: projects(1), items: projectChats("p1", 3), ...sets });

          expect(folderStatus(label)).toBe(true);
        }
      );

      it("shows the most urgent status among the hidden chats (waiting over unread over running)", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 3),
          runningChatIds: new Set(["chats/p1-0.md"]),
          attentionChatIds: new Set(["chats/p1-1.md"]),
          waitingChatIds: new Set(["chats/p1-2.md"]),
        });

        expect(folderStatus("Waiting for permission")).toBe(true);
        expect(folderStatus("Unread result")).toBe(false);
        expect(folderStatus("Running")).toBe(false);
      });

      it("ignores a stale needs-attention snapshot once the live attention flag clears for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 2, { needsAttention: true }),
        });

        expect(folderStatus("Unread result")).toBe(false);
      });

      it("leaves the folder row clear when every chat is visible and its own row shows the status", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 3),
          expandedProjectIds: new Set(["p1"]),
          waitingChatIds: new Set(["chats/p1-2.md"]),
        });

        expect(folderStatus("Waiting for permission")).toBe(false);
        expect(
          within(screen.getByRole("button", { name: /^Chat p1 3/ })).getByLabelText(
            "Waiting for permission"
          )
        ).toBeTruthy();
      });

      it("shows the status of a chat behind Show more on the folder row until it is revealed for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 8),
          expandedProjectIds: new Set(["p1"]),
          waitingChatIds: new Set(["chats/p1-7.md"]),
        });

        expect(folderStatus("Waiting for permission")).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Show more" }));

        expect(folderStatus("Waiting for permission")).toBe(false);
      });

      it("does not count a pinned chat, which stays visible under Pinned, toward its folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({
          projects: projects(1),
          items: projectChats("p1", 2, { pinnedAt: 3 }),
          waitingChatIds: new Set(["chats/p1-1.md"]),
        });

        expect(folderStatus("Waiting for permission")).toBe(false);
      });
    });

    describe("Recents", () => {
      const originalObserver = window.IntersectionObserver;
      let callback: IntersectionObserverCallback;
      const observer = {
        disconnect: jest.fn(),
        observe: jest.fn(),
      } as unknown as IntersectionObserver;

      beforeEach(() => {
        window.IntersectionObserver = jest.fn((nextCallback: IntersectionObserverCallback) => {
          callback = nextCallback;
          return observer;
        });
      });
      afterEach(() => {
        window.IntersectionObserver = originalObserver;
      });

      const recents = Array.from({ length: 45 }, (_, index) =>
        sidebarChat(`chats/r-${index}.md`, `Rec ${index + 1}`, index + 1)
      );

      it("loads 20 chats at a time as the list scrolls for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ items: recents });
        expect(chatTitles(section("Recents"))).toHaveLength(20);

        act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], observer));
        expect(chatTitles(section("Recents"))).toHaveLength(40);

        act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], observer));
        expect(chatTitles(section("Recents"))).toHaveLength(45);
      });

      it("lists the newest chat first", () => {
        renderPanel({ items: [...recents].reverse() });

        expect(chatTitles(section("Recents")).slice(0, 2)).toEqual(["Rec 1", "Rec 2"]);
      });
    });

    describe("chat rows", () => {
      const items = [
        sidebarChat("chats/a.md", "Chat A", 3),
        sidebarChat("chats/b.md", "Chat B", 2),
        sidebarChat("chats/c.md", "Chat C", 1),
      ];

      it("highlights only the row of the active chat", () => {
        renderPanel({ items, activeChatIds: new Set(["chats/b.md", "native:opencode:s1"]) });

        const current = screen
          .getAllByRole("button")
          .filter((row) => row.getAttribute("aria-current") === "true");
        expect(current.map((row) => row.textContent!.trim())).toEqual(["Chat B"]);
      });

      it.each([
        ["running", { runningChatIds: new Set(["chats/b.md"]) }, "Running"],
        ["waiting", { waitingChatIds: new Set(["chats/b.md"]) }, "Waiting for permission"],
        ["unread", { attentionChatIds: new Set(["chats/b.md"]) }, "Unread result"],
      ])("marks a %s chat's row with its status", (_status, sets, label) => {
        renderPanel({ items, ...sets });

        expect(
          within(screen.getByRole("button", { name: /^Chat B/ })).getByLabelText(label)
        ).toBeTruthy();
        expect(screen.getAllByLabelText(label)).toHaveLength(1);
      });

      it("marks only chats with a live session and closes that session by its history id for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
        const actions = inertChatActions({
          onCloseSession: jest.fn(async () => {}),
          getChatBookmarkState: () => new Promise<never>(() => {}),
        });
        const { onOpenChat } = renderPanel({
          items,
          actions,
          openChatIds: new Set(["chats/b.md"]),
        });

        expect(screen.getAllByLabelText("Session open")).toHaveLength(1);
        expect(
          within(screen.getByRole("button", { name: /^Chat B/ })).getByLabelText("Session open")
        ).toBeTruthy();
        fireEvent.pointerDown(
          within(screen.getByRole("button", { name: /^Chat B/ }).parentElement!).getByRole(
            "button",
            { name: "More actions" }
          ),
          { button: 0, ctrlKey: false }
        );
        fireEvent.click(screen.getByRole("menuitem", { name: "Close chat" }));

        expect(actions.onCloseSession).toHaveBeenCalledWith("chats/b.md");
        expect(onOpenChat).not.toHaveBeenCalled();
      });
    });

    describe("new project", () => {
      const plusButton = () =>
        within(section("Projects")).getByRole("button", { name: "New project" });
      const startProject = () => fireEvent.click(plusButton());
      const dialog = () => screen.queryByRole("dialog", { name: "New project" });
      const nameField = () => screen.getByPlaceholderText("Project name");
      const typeName = (name: string) => fireEvent.change(nameField(), { target: { value: name } });

      afterEach(() => jest.restoreAllMocks());

      it("opens the project dialog from the Projects plus even when no project exists yet for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        renderPanel();

        expect(dialog()).toBeNull();

        startProject();

        expect(dialog()).toBeTruthy();
        expect(nameField()).toBeTruthy();
      });

      it("anchors the dialog to the plus that opened it for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        renderPanel();
        jest.spyOn(plusButton(), "getBoundingClientRect").mockReturnValue({
          top: 100,
          bottom: 120,
          left: 300,
          right: 320,
          width: 20,
          height: 20,
          x: 300,
          y: 100,
          toJSON: () => ({}),
        });

        startProject();

        expect(dialog()!.style.left).toBe("180px");
      });

      it("keeps the plus visible while its dialog is open and hides it again after closing for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        renderPanel();
        const wrapper = plusButton().parentElement!;

        expect(wrapper.classList.contains("tw-visible")).toBe(false);

        startProject();

        expect(wrapper.classList.contains("tw-visible")).toBe(true);

        fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));

        expect(wrapper.classList.contains("tw-visible")).toBe(false);
      });

      it("creates the project with the trimmed name on Enter and closes the dialog for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
        const { onCreateProject } = renderPanel();
        startProject();
        typeName("  Garden plans ");

        await act(async () => {
          fireEvent.keyDown(nameField(), { key: "Enter" });
        });

        expect(onCreateProject).toHaveBeenCalledWith("Garden plans");
        expect(dialog()).toBeNull();
      });

      it("creates the project from the Create button for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
        const { onCreateProject } = renderPanel();
        startProject();
        typeName("Garden plans");

        await act(async () => {
          fireEvent.click(within(dialog()!).getByRole("button", { name: "Create" }));
        });

        expect(onCreateProject).toHaveBeenCalledWith("Garden plans");
        expect(dialog()).toBeNull();
      });

      it("creates nothing and closes the dialog on Cancel for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        const { onCreateProject } = renderPanel();
        startProject();
        typeName("Garden plans");

        fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));

        expect(onCreateProject).not.toHaveBeenCalled();
        expect(dialog()).toBeNull();
      });

      it("creates nothing and closes the dialog on Escape for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
        const { onCreateProject } = renderPanel();
        startProject();
        typeName("Garden plans");

        fireEvent.keyDown(window, { key: "Escape" });

        expect(onCreateProject).not.toHaveBeenCalled();
        expect(dialog()).toBeNull();
      });

      it("keeps the dialog open and reports the creation error when the project cannot be created for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", async () => {
        const onCreateProject = jest
          .fn()
          .mockRejectedValue(new Error('A project with the name "Garden" already exists'));
        renderPanel({ onCreateProject });
        startProject();
        typeName("Garden");

        await act(async () => {
          fireEvent.keyDown(nameField(), { key: "Enter" });
        });

        expect(Notice).toHaveBeenCalledWith('A project with the name "Garden" already exists');
        expect(dialog()).toBeTruthy();
        expect((nameField() as HTMLInputElement).value).toBe("Garden");
      });

      it("hides the plus while the title filter is active", () => {
        renderPanel({ items: [sidebarChat("chats/a.md", "Chat A", 1)] });

        fireEvent.click(screen.getByRole("button", { name: "Search chats" }));
        fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
          target: { value: "Chat" },
        });

        expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
      });
    });

    describe("header", () => {
      it("names the sidebar Copilot with the brand icon, then New chat, search and options on the same row for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        const { container } = render(
          <AppContext.Provider value={new App()}>
            <SessionsSidebarPanel {...baseProps()} />
          </AppContext.Provider>
        );

        const heading = screen.getByRole("heading", { name: "Copilot" });
        expect(heading.querySelector("svg")).not.toBeNull();
        const headerRow = heading.parentElement!;
        expect(
          within(headerRow)
            .getAllByRole("button")
            .map((button) => button.getAttribute("aria-label") ?? button.textContent)
        ).toEqual(["New chat", "Search chats", "Sidebar options"]);
        container.remove();
      });

      it("shows New chat as a primary button named by its own label, with no hover tooltip, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel();

        const newChat = screen.getByRole("button", { name: "New chat" });
        expect(newChat.classList.contains("mod-cta")).toBe(true);
        expect(newChat.hasAttribute("aria-label")).toBe(false);
        expect(newChat.hasAttribute("title")).toBe(false);
      });

      it("starts a new chat from the New chat button", () => {
        const { onNewChat } = renderPanel();

        fireEvent.click(screen.getByRole("button", { name: "New chat" }));

        expect(onNewChat).toHaveBeenCalledTimes(1);
      });

      it("opens the Archived view from the header menu for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        const { onViewArchived } = renderPanel();

        fireEvent.pointerDown(screen.getByRole("button", { name: "Sidebar options" }), {
          button: 0,
          ctrlKey: false,
        });
        fireEvent.click(screen.getByRole("menuitem", { name: "View archived" }));

        expect(onViewArchived).toHaveBeenCalledTimes(1);
      });
    });

    describe("title filter", () => {
      const items = [
        sidebarChat("chats/pin.md", "Pin launch plan", 1, { pinnedAt: 5, projectId: "p1" }),
        sidebarChat("chats/rec.md", "Rec launch notes", 2),
        sidebarChat("chats/other.md", "Rec unrelated", 3),
        ...projectChats("p1", 2),
        sidebarChat("chats/p1-launch.md", "Chat p1 launch", 9, { projectId: "p1" }),
      ];

      function search(text: string) {
        fireEvent.click(screen.getByRole("button", { name: "Search chats" }));
        fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
          target: { value: text },
        });
      }

      it("hides the search field until the header search icon is used", () => {
        renderPanel({ items });

        expect(screen.queryByPlaceholderText("Search chats...")).toBeNull();
      });

      it("puts the cursor in the search field as soon as the header search icon opens it for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ items });

        fireEvent.click(screen.getByRole("button", { name: "Search chats" }));

        expect(document.activeElement).toBe(screen.getByPlaceholderText("Search chats..."));
      });

      it("closes search on Escape, restores every group and returns focus to the search button for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ items });
        fireEvent.click(screen.getByRole("button", { name: "Search chats" }));
        fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
          target: { value: "zzz" },
        });

        fireEvent.keyDown(screen.getByPlaceholderText("Search chats..."), { key: "Escape" });

        expect(screen.queryByPlaceholderText("Search chats...")).toBeNull();
        expect(screen.queryByText("No matching chats")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search chats" }));
      });

      it("lists matching chats from every group in one list, even from a collapsed project, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ items, projects: projects(1) });

        search("launch");

        expect(screen.queryByRole("region")).toBeNull();
        expect(
          screen
            .getAllByRole("button", { name: /launch/ })
            .map((button) => (button.textContent ?? "").trim())
        ).toEqual(["Pin launch planProject 1", "Rec launch notes", "Chat p1 launchProject 1"]);
      });

      it("says no chats match when nothing matches for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
        renderPanel({ items, projects: projects(1) });

        search("zebra");

        expect(screen.getByText("No matching chats")).toBeTruthy();
        expect(screen.queryByRole("region")).toBeNull();
      });

      it("restores the grouped view when the filter is cleared", () => {
        renderPanel({ items, projects: projects(1) });
        search("launch");

        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

        expect(screen.getByRole("region", { name: "Pinned" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Recents" })).toBeTruthy();
      });

      it("restores the grouped view when the search is closed with the header icon", () => {
        renderPanel({ items, projects: projects(1) });
        search("launch");

        fireEvent.click(screen.getByRole("button", { name: "Search chats" }));

        expect(screen.queryByPlaceholderText("Search chats...")).toBeNull();
        expect(screen.getByRole("region", { name: "Projects" })).toBeTruthy();
      });
    });
  });
});
