import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App, type Modal } from "obsidian";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { AppContext } from "@/context";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const mockOpenedModals: Modal[] = [];

jest.mock("obsidian", () => {
  const obsidianMock = jest.requireActual("obsidian");
  class OpenableModal extends obsidianMock.Modal {
    constructor(app: unknown) {
      super(app);
      delete this.onOpen;
      delete this.onClose;
      this.setTitle = (title: string) => this.titleEl.setText(title);
      this.contentEl.empty = () => this.contentEl.replaceChildren();
      this.open = () => {
        mockOpenedModals.push(this as unknown as Modal);
        document.body.appendChild(this.containerEl);
        this.onOpen();
      };
      this.close = jest.fn(() => {
        this.onClose();
        this.containerEl.remove();
      });
    }
  }
  return { ...obsidianMock, Modal: OpenableModal };
});

type SectionItems = React.ComponentProps<typeof GlobalRecentChatsSection>["items"];

const noop = async () => {};
const unsettledBookmarkState = () => new Promise<never>(() => {});

function renderSection(
  props: Partial<React.ComponentProps<typeof GlobalRecentChatsSection>> & {
    openChatIds?: ReadonlySet<string>;
    onCloseSession?: (id: string) => Promise<void>;
    app?: App;
  } = {}
) {
  return render(
    <AppContext.Provider value={props.app ?? new App()}>
      <GlobalRecentChatsSection
        {...{ openChatIds: props.openChatIds, onCloseSession: props.onCloseSession }}
        items={props.items ?? []}
        variant={props.variant}
        title={props.title}
        runningChatIds={props.runningChatIds}
        attentionChatIds={props.attentionChatIds}
        projectNamesById={props.projectNamesById}
        sortStrategy={props.sortStrategy}
        onLoadChat={props.onLoadChat ?? noop}
        onUpdateTitle={props.onUpdateTitle ?? noop}
        onDeleteChat={props.onDeleteChat ?? noop}
        onOpenSourceFile={props.onOpenSourceFile ?? noop}
        onCopyChatLink={props.onCopyChatLink ?? noop}
        onSetChatPinned={props.onSetChatPinned ?? noop}
        getChatBookmarkState={props.getChatBookmarkState ?? unsettledBookmarkState}
        onSetChatBookmarked={props.onSetChatBookmarked ?? noop}
      />
    </AppContext.Provider>
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest<HTMLElement>('[role="button"]');
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

function moreActionsButton(title: string): HTMLElement {
  return within(rowFor(title)).getByRole("button", { name: "More actions" });
}

function openMenuFromButton(title: string): HTMLElement {
  fireEvent.pointerDown(moreActionsButton(title), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function menuEntries(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((entry) =>
    entry.getAttribute("role") === "separator" ? "---" : (entry.textContent ?? "")
  );
}

function chooseMenuItem(menu: HTMLElement, title: string): void {
  fireEvent.click(within(menu).getByRole("menuitem", { name: title }));
}

function lastModal(): Modal {
  const modal = mockOpenedModals.at(-1);
  if (!modal) throw new Error("No modal was opened");
  return modal;
}

function rowTitles(): string[] {
  return screen
    .getAllByRole("button")
    .filter((element) => element.getAttribute("tabindex") === "0")
    .map((row) => row.querySelector("[title]")?.getAttribute("title") ?? "");
}

function queryAttentionDot(container: HTMLElement): Element | null {
  return container.querySelector(".tw-bg-interactive-accent");
}

function makeItem(
  id: string,
  overrides: Partial<React.ComponentProps<typeof GlobalRecentChatsSection>["items"][number]> = {}
): React.ComponentProps<typeof GlobalRecentChatsSection>["items"][number] {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  };
}

function makeRecentItems(prefix: string, count: number): SectionItems {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) =>
    makeItem(`${prefix}-${index}`, {
      createdAt: new Date(now - index),
      lastAccessedAt: new Date(now - index),
    })
  );
}

describe("GlobalRecentChatsSection", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  const originalObserver = window.IntersectionObserver;
  let callback: IntersectionObserverCallback;
  const observer = { disconnect: jest.fn(), observe: jest.fn() } as unknown as IntersectionObserver;
  const intersect = () =>
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);

  beforeEach(() => {
    window.IntersectionObserver = jest.fn((nextCallback: IntersectionObserverCallback) => {
      callback = nextCallback;
      return observer;
    });
  });
  afterEach(() => {
    window.IntersectionObserver = originalObserver;
    jest.restoreAllMocks();
    mockOpenedModals.splice(0).forEach((modal) => modal.containerEl.remove());
  });

  describe("GlobalRecentChatsSection()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/429 shows open sessions and retains saved chats after close", async () => {
      const onLoadChat = jest.fn(noop);
      const onDeleteChat = jest.fn(noop);
      const onCloseSession = jest.fn(noop);
      renderSection({
        items: [makeItem("idle"), makeItem("running"), makeItem("closed")],
        openChatIds: new Set(["idle", "running"]),
        runningChatIds: new Set(["running"]),
        onCloseSession,
        onLoadChat,
        onDeleteChat,
      });
      const liveDots = screen.getAllByLabelText("Session live");
      expect(liveDots).toHaveLength(2);
      expect(liveDots[0].parentElement?.getAttribute("title")).toBe("Session is running");
      expect(screen.getByLabelText("Responding")).toBeTruthy();
      const buttons = screen.getAllByRole("button", { name: "Close chat" });
      expect(buttons).toHaveLength(2);
      fireEvent.keyDown(buttons[0], { key: "Enter" });
      await act(async () => {
        fireEvent.click(buttons[0]);
      });
      expect(onCloseSession).toHaveBeenCalledTimes(1);
      expect(onLoadChat).not.toHaveBeenCalled();
      expect(onDeleteChat).not.toHaveBeenCalled();
      expect(screen.getByText("Chat idle")).toBeTruthy();
    });

    it("defaults to the global empty-state copy", () => {
      renderSection();
      expect(screen.getByText("No recent chats")).toBeTruthy();
    });

    it("uses project-scoped empty-state copy in the project variant", () => {
      renderSection({ variant: "project" });
      expect(screen.getByText("No chats in this project yet")).toBeTruthy();
    });

    it("applies the optional title as the section's accessible label", () => {
      renderSection({ variant: "project", title: "Project Chats" });
      expect(screen.getByLabelText("Project Chats")).toBeTruthy();
    });

    it("renders a running spinner instead of the time for a backgrounded session", () => {
      const item = makeItem("running-1");
      renderSection({ items: [item], runningChatIds: new Set([item.id]) });
      expect(screen.getByLabelText("Responding")).toBeTruthy();
      expect(screen.queryByText("now")).toBeNull();
    });

    it("renders the relative time (no spinner) when the session is not running", () => {
      const item = makeItem("idle-1");
      renderSection({ items: [item], runningChatIds: new Set() });
      expect(screen.queryByLabelText("Responding")).toBeNull();
      expect(screen.getByText("now")).toBeTruthy();
    });

    it("shows the attention dot from the live set even when the item snapshot lacks it", () => {
      const item = makeItem("done-live");
      expect(item.needsAttention).toBeUndefined();
      const { container } = renderSection({
        items: [item],
        attentionChatIds: new Set([item.id]),
      });
      expect(queryAttentionDot(container)).not.toBeNull();
    });

    it("shows no attention dot when neither the snapshot nor the live set flags it", () => {
      const item = makeItem("plain-1");
      const { container } = renderSection({ items: [item], attentionChatIds: new Set() });
      expect(queryAttentionDot(container)).toBeNull();
    });

    it("shows a project badge beside project-scoped chats on the global landing", () => {
      const item = makeItem("project-chat", { projectId: "project-1" });
      renderSection({
        items: [item],
        projectNamesById: { "project-1": "Product research" },
      });

      const badge = screen.getByLabelText("Project: Product research");
      const timestamp = screen.getByTitle(new Date(item.lastAccessedAt).toLocaleString());
      const title = screen.getByText(item.title);
      expect(badge.textContent).toBe("Product research");
      expect(badge.getAttribute("title")).toBe("Product research");
      expect(badge.parentElement).toBe(timestamp.parentElement);
      expect(title.nextElementSibling).toBe(badge.parentElement);
    });

    it("omits project badges for global chats, unknown projects, and project landings", () => {
      const { unmount } = renderSection({
        variant: "project",
        items: [makeItem("project-chat", { projectId: "project-1" })],
        projectNamesById: { "project-1": "Product research" },
      });
      expect(screen.queryByLabelText("Project: Product research")).toBeNull();
      unmount();

      renderSection({
        items: [makeItem("global-chat"), makeItem("unknown-project", { projectId: "missing" })],
        projectNamesById: { "project-1": "Product research" },
      });
      expect(screen.queryByLabelText(/^Project:/)).toBeNull();
    });

    it("uses an explicit ellipsis contract while preserving the full title for hover", () => {
      const title = "Do a research on Mobbin that explains how people express their app value";
      renderSection({ items: [makeItem("long-title", { title })] });

      const titleElement = screen.getByText(title);
      expect(titleElement.classList.contains("tw-block")).toBe(true);
      expect(titleElement.classList.contains("tw-truncate")).toBe(true);
      expect(titleElement.getAttribute("title")).toBe(title);
    });

    it("renders every chat in the existing scroll region without a View-all trigger", () => {
      const items = Array.from({ length: 12 }, (_, i) => makeItem(`overflow-${i}`));
      const { container } = renderSection({ items });
      expect(screen.getAllByText(/^Chat overflow-/)).toHaveLength(12);
      expect(screen.queryByText("View all chats")).toBeNull();

      const scrollRegion = container.querySelector(
        "[data-radix-scroll-area-viewport]"
      )?.parentElement;
      expect(scrollRegion?.classList.contains("tw-min-h-0")).toBe(true);
      expect(scrollRegion?.classList.contains("tw-flex-1")).toBe(true);
      expect(scrollRegion?.classList.contains("tw-max-h-56")).toBe(false);
    });

    it("renders project badges for every chat in the global scroll region", () => {
      const items = Array.from({ length: 11 }, (_, i) =>
        makeItem(`project-overflow-${i}`, { projectId: "project-1" })
      );
      renderSection({
        items,
        projectNamesById: { "project-1": "Product research" },
      });

      expect(screen.getAllByLabelText("Project: Product research")).toHaveLength(11);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 finds an older chat beyond the initial rendered batch", () => {
      const items = makeRecentItems("search", 120);
      renderSection({ items });
      expect(screen.queryByText("Chat search-100")).toBeNull();

      fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
        target: { value: "Chat search-100" },
      });

      expect(screen.getByText("Chat search-100")).toBeTruthy();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 honors the saved name and created chat-history sort strategies", () => {
      const items = [
        makeItem("alpha", {
          title: "Alpha",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastAccessedAt: new Date("2026-01-03T00:00:00Z"),
        }),
        makeItem("zulu", {
          title: "Zulu",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          lastAccessedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ];

      const { unmount } = renderSection({ items, sortStrategy: "name" });
      expect(screen.getAllByText(/^(Alpha|Zulu)$/).map((element) => element.textContent)).toEqual([
        "Alpha",
        "Zulu",
      ]);
      unmount();

      renderSection({ items, sortStrategy: "created" });
      expect(screen.getAllByText(/^(Alpha|Zulu)$/).map((element) => element.textContent)).toEqual([
        "Zulu",
        "Alpha",
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 renders at most 50 chats before the user scrolls", () => {
      const items = makeRecentItems("paged", 120);
      renderSection({ items });

      expect(screen.getAllByText(/^Chat paged-/)).toHaveLength(50);
      expect(screen.queryByText("Chat paged-50")).toBeNull();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 appends 50 chats when the scroll sentinel enters view", () => {
      const items = makeRecentItems("paged", 120);
      renderSection({ items });

      act(() => intersect());

      expect(screen.getAllByText(/^Chat paged-/)).toHaveLength(100);
      expect(screen.getByText("Chat paged-50")).toBeTruthy();
      expect(screen.queryByText("Chat paged-100")).toBeNull();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 resets a new search to the first 50 matching chats", () => {
      const items = makeRecentItems("search-page", 120);
      renderSection({ items });
      act(() => intersect());
      expect(screen.getAllByText(/^Chat search-page-/)).toHaveLength(100);

      fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
        target: { value: "Chat search-page" },
      });

      expect(screen.getAllByText(/^Chat search-page-/)).toHaveLength(50);
    });

    it("shows only Pin chat, Open source note, and More actions when hovering a saved chat whose session is closed", () => {
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })] });

      const actions = within(rowFor("Saved chat"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));

      expect(actions).toEqual(["Pin chat", "Open source note", "More actions"]);
    });

    it("leads the hover actions with Close chat when the chat's session is open", () => {
      renderSection({
        items: [makeItem("chats/open.md", { title: "Open chat" })],
        openChatIds: new Set(["chats/open.md"]),
        onCloseSession: noop,
      });

      const actions = within(rowFor("Open chat"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));

      expect(actions).toEqual(["Pin chat", "Close chat", "Open source note", "More actions"]);
    });

    it("pins an unpinned chat from its Pin chat action without opening it", async () => {
      const onSetChatPinned = jest.fn(noop);
      const onLoadChat = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        onSetChatPinned,
        onLoadChat,
      });

      await act(async () => {
        fireEvent.click(within(rowFor("Saved chat")).getByRole("button", { name: "Pin chat" }));
      });

      expect(onSetChatPinned).toHaveBeenCalledWith("chats/saved.md", true);
      expect(onLoadChat).not.toHaveBeenCalled();
    });

    it("leads the hover actions with Unpin chat for a pinned chat and unpins it", async () => {
      const onSetChatPinned = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/pinned.md", { title: "Pinned chat", pinnedAt: 5_000 })],
        onSetChatPinned,
      });
      const row = rowFor("Pinned chat");

      expect(within(row).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Unpin chat");
      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: "Unpin chat" }));
      });

      expect(onSetChatPinned).toHaveBeenCalledWith("chats/pinned.md", false);
    });

    it.each([
      ["Pin chat", "an unpinned", undefined, true],
      ["Unpin chat", "a pinned", 5_000, false],
    ])(
      "offers %s in the menu for %s chat and sets its pinned state",
      async (menuItem, _state, pinnedAt, pinned) => {
        const onSetChatPinned = jest.fn(noop);
        renderSection({
          items: [makeItem("chats/saved.md", { title: "Saved chat", pinnedAt })],
          onSetChatPinned,
        });

        const menu = openMenuFromButton("Saved chat");
        await act(async () => chooseMenuItem(menu, menuItem));

        expect(onSetChatPinned).toHaveBeenCalledWith("chats/saved.md", pinned);
      }
    );

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 lists pinned chats first with the newest pin on top, then the other chats in the saved sort order", () => {
      renderSection({
        items: [
          makeItem("recent", { title: "Recent", lastAccessedAt: new Date(9_000) }),
          makeItem("first-pin", {
            title: "First pin",
            lastAccessedAt: new Date(8_000),
            pinnedAt: 1_000,
          }),
          makeItem("older", { title: "Older", lastAccessedAt: new Date(2_000) }),
          makeItem("second-pin", {
            title: "Second pin",
            lastAccessedAt: new Date(1_000),
            pinnedAt: 2_000,
          }),
        ],
      });

      expect(rowTitles()).toEqual(["Second pin", "First pin", "Recent", "Older"]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 keeps pinned chats in pin order while the other chats follow a changed sort strategy", () => {
      const items = [
        makeItem("zulu-pin", { title: "Zulu pin", pinnedAt: 2_000 }),
        makeItem("alpha-pin", { title: "Alpha pin", pinnedAt: 1_000 }),
        makeItem("zulu", { title: "Zulu", lastAccessedAt: new Date(9_000) }),
        makeItem("alpha", { title: "Alpha", lastAccessedAt: new Date(1_000) }),
      ];

      renderSection({ items, sortStrategy: "name" });

      expect(rowTitles()).toEqual(["Zulu pin", "Alpha pin", "Alpha", "Zulu"]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 renders every pinned chat in the first batch even when it is the least recently used", () => {
      renderSection({
        items: [
          ...makeRecentItems("paged", 60),
          makeItem("stale-pin", {
            title: "Stale pin",
            lastAccessedAt: new Date(0),
            pinnedAt: 1_000,
          }),
        ],
      });

      expect(rowTitles()[0]).toBe("Stale pin");
    });

    it("separates pinned chats from the other chats with a divider only when both groups have chats", () => {
      const { unmount } = renderSection({
        items: [makeItem("pinned", { pinnedAt: 1_000 }), makeItem("unpinned")],
      });
      expect(screen.getAllByRole("separator")).toHaveLength(1);
      unmount();

      renderSection({ items: [makeItem("pinned", { pinnedAt: 1_000 })] });
      expect(screen.queryByRole("separator")).toBeNull();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 keeps matching pinned chats above the divider while searching and drops the divider when no unpinned chat matches", () => {
      renderSection({
        items: [
          makeItem("plan-pinned", {
            title: "Plan launch",
            lastAccessedAt: new Date(1_000),
            pinnedAt: 1_000,
          }),
          makeItem("plan-unpinned", { title: "Plan budget", lastAccessedAt: new Date(9_000) }),
          makeItem("notes", { title: "Meeting notes", pinnedAt: 2_000 }),
        ],
      });
      const search = screen.getByPlaceholderText("Search chats...");

      fireEvent.change(search, { target: { value: "plan" } });
      expect(rowTitles()).toEqual(["Plan launch", "Plan budget"]);
      expect(screen.getAllByRole("separator")).toHaveLength(1);

      fireEvent.change(search, { target: { value: "launch" } });
      expect(rowTitles()).toEqual(["Plan launch"]);
      expect(screen.queryByRole("separator")).toBeNull();
    });

    it("lists every action, including the hover-strip ones, with a warning-styled Delete in the More actions menu", () => {
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })] });

      const menu = openMenuFromButton("Saved chat");

      expect(menuEntries(menu)).toEqual([
        "Pin chat",
        "Open source note",
        "Rename",
        "Copy chat link",
        "---",
        "Delete",
      ]);
      expect(within(menu).getByRole("menuitem", { name: "Delete" }).className).toContain(
        "tw-text-error"
      );
    });

    it("adds Close chat above Delete in the menu when the chat's session is open", () => {
      renderSection({
        items: [makeItem("chats/open.md", { title: "Open chat" })],
        openChatIds: new Set(["chats/open.md"]),
        onCloseSession: noop,
      });

      expect(menuEntries(openMenuFromButton("Open chat"))).toEqual([
        "Pin chat",
        "Open source note",
        "Rename",
        "Copy chat link",
        "---",
        "Close chat",
        "Delete",
      ]);
    });

    it("adds Add to bookmarks above the separator once a saved chat's bookmark state loads", async () => {
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        getChatBookmarkState: async () => "not-bookmarked",
      });

      const menu = openMenuFromButton("Saved chat");
      await within(menu).findByRole("menuitem", { name: "Add to bookmarks" });

      expect(menuEntries(menu)).toEqual([
        "Pin chat",
        "Open source note",
        "Rename",
        "Copy chat link",
        "Add to bookmarks",
        "---",
        "Delete",
      ]);
    });

    it("opens the chosen chat's source note when Open source note is selected from the menu", () => {
      const onOpenSourceFile = jest.fn(noop);
      const onLoadChat = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        onOpenSourceFile,
        onLoadChat,
      });

      chooseMenuItem(openMenuFromButton("Saved chat"), "Open source note");

      expect(onOpenSourceFile).toHaveBeenCalledWith("chats/saved.md");
      expect(onLoadChat).not.toHaveBeenCalled();
    });

    it("closes the chosen chat's session when Close chat is selected from the menu", async () => {
      const onCloseSession = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/open.md", { title: "Open chat" })],
        openChatIds: new Set(["chats/open.md"]),
        onCloseSession,
      });

      const menu = openMenuFromButton("Open chat");
      await act(async () => chooseMenuItem(menu, "Close chat"));

      expect(onCloseSession).toHaveBeenCalledWith("chats/open.md");
    });

    it("bookmarks the chosen chat under its title when Add to bookmarks is selected", async () => {
      const onSetChatBookmarked = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        getChatBookmarkState: async () => "not-bookmarked",
        onSetChatBookmarked,
      });

      const menu = openMenuFromButton("Saved chat");
      fireEvent.click(await within(menu).findByRole("menuitem", { name: "Add to bookmarks" }));

      expect(onSetChatBookmarked).toHaveBeenCalledWith("chats/saved.md", "Saved chat", true);
    });

    it("offers Remove from bookmarks for a bookmarked chat and removes its bookmark when selected", async () => {
      const onSetChatBookmarked = jest.fn(noop);
      const getChatBookmarkState = jest.fn(async () => "bookmarked" as const);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        getChatBookmarkState,
        onSetChatBookmarked,
      });

      const menu = openMenuFromButton("Saved chat");
      fireEvent.click(await within(menu).findByRole("menuitem", { name: "Remove from bookmarks" }));

      expect(getChatBookmarkState).toHaveBeenCalledWith("chats/saved.md");
      expect(menuEntries(menu)).not.toContain("Add to bookmarks");
      expect(onSetChatBookmarked).toHaveBeenCalledWith("chats/saved.md", "Saved chat", false);
    });

    it("opens the menu from the More actions button without opening the chat", () => {
      const onLoadChat = jest.fn(noop);
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })], onLoadChat });

      openMenuFromButton("Saved chat");

      expect(moreActionsButton("Saved chat").getAttribute("aria-expanded")).toBe("true");
      expect(onLoadChat).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/693 opens the menu in the row's own window when another window is active", () => {
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })] });
      const otherWindowDocument = document.implementation.createHTMLDocument();
      const globals = window as unknown as { activeDocument: Document };
      globals.activeDocument = otherWindowDocument;
      try {
        openMenuFromButton("Saved chat");
      } finally {
        globals.activeDocument = document;
      }

      expect(otherWindowDocument.querySelector('[role="menu"]')).toBeNull();
    });

    it("opens the same menu instead of the browser menu when the row is right-clicked", () => {
      const onLoadChat = jest.fn(noop);
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })], onLoadChat });

      const notPrevented = fireEvent.contextMenu(rowFor("Saved chat"));

      expect(notPrevented).toBe(false);
      expect(menuEntries(screen.getByRole("menu"))).toContain("Rename");
      expect(onLoadChat).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/693 keeps the hover actions shown in place of the time while the menu is open", () => {
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })] });

      openMenuFromButton("Saved chat");

      expect(moreActionsButton("Saved chat").parentElement?.className).toMatch(/(^| )tw-flex( |$)/);
      expect(within(rowFor("Saved chat")).getByText(/ago|now/).className).toMatch(
        /(^| )tw-hidden( |$)/
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/693 does not open the chat when a menu item is chosen", () => {
      const onLoadChat = jest.fn(noop);
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })], onLoadChat });

      chooseMenuItem(openMenuFromButton("Saved chat"), "Copy chat link");

      expect(onLoadChat).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/693 leaves Open source note out for a chat with no saved note", () => {
      const nativeId = buildNativeChatId("opencode", "session-1");
      renderSection({ items: [makeItem(nativeId, { title: "Native chat" })] });

      const menu = openMenuFromButton("Native chat");

      expect(menuEntries(menu)).not.toContain("Open source note");
      expect(
        within(rowFor("Native chat")).queryByRole("button", { name: "Open source note" })
      ).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/699 offers Copy chat link for a chat with no saved note and copies it by that chat's id", () => {
      const nativeId = buildNativeChatId("opencode", "session-1");
      const onCopyChatLink = jest.fn(noop);
      renderSection({ items: [makeItem(nativeId, { title: "Native chat" })], onCopyChatLink });

      chooseMenuItem(openMenuFromButton("Native chat"), "Copy chat link");

      expect(onCopyChatLink).toHaveBeenCalledWith(nativeId);
    });

    it("copies the link of the chosen chat when Copy chat link is selected", () => {
      const onCopyChatLink = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        onCopyChatLink,
      });

      chooseMenuItem(openMenuFromButton("Saved chat"), "Copy chat link");

      expect(onCopyChatLink).toHaveBeenCalledWith("chats/saved.md");
    });

    it("renames the chat from a Rename chat dialog prefilled with its current title", async () => {
      const onUpdateTitle = jest.fn(noop);
      renderSection({
        items: [makeItem("chats/saved.md", { title: "Saved chat" })],
        onUpdateTitle,
      });

      const menu = openMenuFromButton("Saved chat");
      act(() => chooseMenuItem(menu, "Rename"));
      const dialog = lastModal();
      const field = within(dialog.contentEl).getByRole("textbox", { name: "Chat title" });
      expect(dialog.titleEl.textContent).toBe("Rename chat");
      expect(field).toHaveProperty("value", "Saved chat");
      fireEvent.change(field, { target: { value: "Launch checklist" } });
      await act(async () => {
        fireEvent.click(within(dialog.contentEl).getByRole("button", { name: "Save" }));
      });

      expect(onUpdateTitle).toHaveBeenCalledWith("chats/saved.md", "Launch checklist");
      expect(dialog.close).toHaveBeenCalled();
    });

    it("deletes the chat after the user confirms in the Delete chat dialog", async () => {
      const onDeleteChat = jest.fn(noop);
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })], onDeleteChat });

      const menu = openMenuFromButton("Saved chat");
      act(() => chooseMenuItem(menu, "Delete"));
      const dialog = lastModal();
      expect(dialog.titleEl.textContent).toBe("Delete chat");
      expect(within(dialog.contentEl).getByText("Delete this chat from Copilot?")).toBeTruthy();
      await act(async () => {
        fireEvent.click(within(dialog.contentEl).getByRole("button", { name: "Delete" }));
      });

      expect(onDeleteChat).toHaveBeenCalledWith("chats/saved.md");
    });

    it("keeps the chat when the Delete chat dialog is cancelled", () => {
      const onDeleteChat = jest.fn(noop);
      renderSection({ items: [makeItem("chats/saved.md", { title: "Saved chat" })], onDeleteChat });

      const menu = openMenuFromButton("Saved chat");
      act(() => chooseMenuItem(menu, "Delete"));
      act(() => {
        fireEvent.click(within(lastModal().contentEl).getByRole("button", { name: "Cancel" }));
      });

      expect(onDeleteChat).not.toHaveBeenCalled();
      expect(screen.getByText("Saved chat")).toBeTruthy();
    });

    it.each([["claude", "Claude Code"]])(
      "https://github.com/logancyang/obsidian-copilot/issues/2888 says in the Delete chat dialog that the %s agent may keep its own copy",
      async (backendId, agent) => {
        renderSection({
          items: [makeItem("chats/agent__a.md", { title: "Agent chat", backendId })],
        });

        const menu = openMenuFromButton("Agent chat");
        act(() => chooseMenuItem(menu, "Delete"));

        expect(
          within(lastModal().contentEl).getByText(
            `Delete this chat from Copilot? ${agent} may keep its own copy of this conversation on this computer.`
          )
        ).toBeTruthy();
      }
    );

    it("refreshes once when the parent re-renders with the items that refresh produced", () => {
      const loadHistory = jest.fn(async () => {});
      const app = new App();
      const Parent = ({ items }: { items: SectionItems }) => (
        <AppContext.Provider value={app}>
          <GlobalRecentChatsSection
            items={items}
            onLoadChat={noop}
            onUpdateTitle={noop}
            onDeleteChat={noop}
            onOpenSourceFile={noop}
            onCopyChatLink={noop}
            onSetChatPinned={noop}
            getChatBookmarkState={async () => "unavailable"}
            onSetChatBookmarked={noop}
            onLoadHistory={safeAsyncHandler(loadHistory)}
          />
        </AppContext.Provider>
      );

      const { rerender } = render(<Parent items={[]} />);
      expect(loadHistory).toHaveBeenCalledTimes(1);

      rerender(<Parent items={[makeItem("loaded-1")]} />);
      rerender(<Parent items={[makeItem("loaded-1"), makeItem("loaded-2")]} />);

      expect(loadHistory).toHaveBeenCalledTimes(1);
    });
  });
});
