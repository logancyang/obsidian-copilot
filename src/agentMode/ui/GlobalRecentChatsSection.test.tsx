import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

type SectionItems = React.ComponentProps<typeof GlobalRecentChatsSection>["items"];

const noop = async () => {};

function renderSection(
  props: Partial<React.ComponentProps<typeof GlobalRecentChatsSection>> & {
    openChatIds?: ReadonlySet<string>;
    onCloseSession?: (id: string) => Promise<void>;
  } = {}
) {
  return render(
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
    />
  );
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
      const buttons = screen.getAllByRole("button", { name: "Close session" });
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

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 keeps a rename draft when updating the title fails", async () => {
      const onUpdateTitle = jest.fn(async () => {
        throw new Error("rename failed");
      });
      renderSection({ items: [makeItem("rename-failure")], onUpdateTitle });

      fireEvent.click(screen.getByTitle("Rename"));
      const input = screen.getByDisplayValue("Chat rename-failure");
      fireEvent.change(input, { target: { value: "Retained draft" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(onUpdateTitle).toHaveBeenCalledWith("rename-failure", "Retained draft");
      expect(screen.getByDisplayValue("Retained draft")).toBeTruthy();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3040 keeps delete confirmation available when deletion fails", async () => {
      const onDeleteChat = jest.fn(async () => {
        throw new Error("delete failed");
      });
      renderSection({ items: [makeItem("delete-failure")], onDeleteChat });

      fireEvent.click(screen.getByTitle("Delete"));
      await act(async () => {
        fireEvent.click(screen.getByTitle("Confirm delete"));
      });

      expect(onDeleteChat).toHaveBeenCalledWith("delete-failure");
      expect(screen.getByTitle("Confirm delete")).toBeTruthy();
    });

    it.each([
      ["claude", "Removes: chat file, session index entry and Claude transcript. Keeps: nothing."],
      ["codex", "Removes: chat file and session index entry. Keeps: Codex transcript."],
    ])(
      "https://github.com/logancyang/obsidian-copilot/issues/2888 names what a %s chat delete removes and keeps",
      (backendId, summary) => {
        renderSection({ items: [makeItem("chats/agent__a.md", { backendId })] });

        expect(screen.queryByText(/^Removes:/)).toBeNull();
        fireEvent.click(screen.getByTitle("Delete"));

        expect(screen.getByText(summary)).toBeTruthy();
      }
    );

    it("refreshes once when the parent re-renders with the items that refresh produced", () => {
      const loadHistory = jest.fn(async () => {});
      const Parent = ({ items }: { items: SectionItems }) => (
        <GlobalRecentChatsSection
          items={items}
          onLoadChat={noop}
          onUpdateTitle={noop}
          onDeleteChat={noop}
          onOpenSourceFile={noop}
          onLoadHistory={safeAsyncHandler(loadHistory)}
        />
      );

      const { rerender } = render(<Parent items={[]} />);
      expect(loadHistory).toHaveBeenCalledTimes(1);

      rerender(<Parent items={[makeItem("loaded-1")]} />);
      rerender(<Parent items={[makeItem("loaded-1"), makeItem("loaded-2")]} />);

      expect(loadHistory).toHaveBeenCalledTimes(1);
    });
  });
});
