import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

type SectionItems = React.ComponentProps<typeof GlobalRecentChatsSection>["items"];

// jsdom lacks Obsidian's portal document and the observer used to page the open
// View-all popover, so supply inert browser equivalents for that interaction.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  window.IntersectionObserver = class implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    disconnect = jest.fn();
    observe = jest.fn();
    takeRecords = jest.fn(() => []);
    unobserve = jest.fn();
  };
});

const noop = async () => {};

function renderSection(props: Partial<React.ComponentProps<typeof GlobalRecentChatsSection>> = {}) {
  return render(
    <GlobalRecentChatsSection
      items={props.items ?? []}
      variant={props.variant}
      title={props.title}
      runningChatIds={props.runningChatIds}
      attentionChatIds={props.attentionChatIds}
      projectNamesById={props.projectNamesById}
      onLoadChat={noop}
      onUpdateTitle={noop}
      onDeleteChat={noop}
      onOpenSourceFile={noop}
    />
  );
}

// The attention dot is `aria-hidden` (purely decorative overlay), so query it
// by its accent class the way ChatIconWithAttention paints it.
function queryAttentionDot(container: HTMLElement): Element | null {
  return container.querySelector(".tw-bg-interactive-accent");
}

function makeItem(
  id: string,
  overrides: Partial<React.ComponentProps<typeof GlobalRecentChatsSection>["items"][number]> = {}
): React.ComponentProps<typeof GlobalRecentChatsSection>["items"][number] {
  // `lastAccessedAt` set to "now" so the relative-time label renders the stable
  // `now` bucket regardless of when the test runs.
  return {
    id,
    title: `Chat ${id}`,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  };
}

describe("GlobalRecentChatsSection", () => {
  describe("GlobalRecentChatsSection()", () => {
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
      expect(screen.getByLabelText("Running")).toBeTruthy();
      expect(screen.queryByText("now")).toBeNull();
    });

    it("renders the relative time (no spinner) when the session is not running", () => {
      const item = makeItem("idle-1");
      renderSection({ items: [item], runningChatIds: new Set() });
      expect(screen.queryByLabelText("Running")).toBeNull();
      expect(screen.getByText("now")).toBeTruthy();
    });

    it("shows the attention dot from the live set even when the item snapshot lacks it", () => {
      // The handoff case: a backgrounded session finished AFTER the history items
      // were loaded — the stale snapshot says no attention, the live set says yes.
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

    it("caps the inline preview at 5 chats and offers a View-all trigger on overflow", () => {
      const items = Array.from({ length: 7 }, (_, i) => makeItem(`overflow-${i}`));
      renderSection({ items });
      expect(screen.getAllByText(/^Chat overflow-/)).toHaveLength(5);
      expect(screen.getByText("View all chats")).toBeTruthy();
    });

    it("renders project badges in the View-all popover from the global landing", () => {
      const items = Array.from({ length: 6 }, (_, i) =>
        makeItem(`project-overflow-${i}`, { projectId: "project-1" })
      );
      renderSection({
        items,
        projectNamesById: { "project-1": "Product research" },
      });

      expect(screen.getAllByLabelText("Project: Product research")).toHaveLength(5);
      fireEvent.click(screen.getByText("View all chats"));
      expect(screen.getAllByLabelText("Project: Product research")).toHaveLength(11);
    });

    it("shows every match (no cap, no View-all) while searching", () => {
      const items = Array.from({ length: 7 }, (_, i) => makeItem(`search-${i}`));
      renderSection({ items });
      fireEvent.change(screen.getByPlaceholderText("Search chats..."), {
        target: { value: "Chat search" },
      });
      expect(screen.getAllByText(/^Chat search-/)).toHaveLength(7);
      expect(screen.queryByText("View all chats")).toBeNull();
    });

    it("refreshes once when the parent re-renders with the items that refresh produced", () => {
      // The mount refresh is keyed to `onLoadHistory`, and a completed load
      // stores a fresh items array that re-renders the parent. A parent that
      // hands over a newly allocated wrapper each render therefore re-arms this
      // effect with the result of its own load and loops until the tab
      // unmounts. AgentHome wraps inline, so the identity has to come from
      // `safeAsyncHandler` itself.
      // `loadHistory` stands in for AgentHome's `useCallback`-stable loader; the
      // wrapper around it is built during render, as AgentHome builds it.
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
