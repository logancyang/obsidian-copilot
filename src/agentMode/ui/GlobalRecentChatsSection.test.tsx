import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";

// jsdom lacks Obsidian's `activeDocument`; the section's View-all popover portals
// into it. The empty-state paths under test never open it, but alias defensively.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
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
  id: string
): React.ComponentProps<typeof GlobalRecentChatsSection>["items"][number] {
  // `lastAccessedAt` set to "now" so the relative-time label renders the stable
  // `now` bucket regardless of when the test runs.
  return {
    id,
    title: `Chat ${id}`,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

describe("GlobalRecentChatsSection", () => {
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

  it("caps the inline preview at 5 chats and offers a View-all trigger on overflow", () => {
    const items = Array.from({ length: 7 }, (_, i) => makeItem(`overflow-${i}`));
    renderSection({ items });
    expect(screen.getAllByText(/^Chat overflow-/)).toHaveLength(5);
    expect(screen.getByText("View all chats")).toBeTruthy();
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
});
