import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// Shared test key for storageKey tests.
const TEST_STORAGE_KEY = "test:shelf-tab";

// The tooltip portal targets Obsidian's `activeDocument` global (popout-safe);
// jsdom has no such global, so point it at the test document.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function renderShelf(sections: AgentHomeShelfSection[], storageKey?: string) {
  return render(
    <TooltipProvider>
      <AgentHomeShelf sections={sections} storageKey={storageKey} />
    </TooltipProvider>
  );
}

const chats: AgentHomeShelfSection = {
  id: "chats",
  icon: <span />,
  title: "Recent Chats",
  count: 2,
  renderBody: () => <div>CHATS BODY</div>,
};

const projectsDisabled: AgentHomeShelfSection = {
  id: "projects",
  icon: <span />,
  title: "Projects",
  count: 5,
  disabled: true,
  disabledTooltip: "Coming soon",
  renderBody: () => <div>PROJECTS BODY</div>,
};

describe("AgentHomeShelf with a disabled section", () => {
  it("activates the first selectable section, not the disabled one", () => {
    renderShelf([chats, projectsDisabled]);
    expect(screen.queryByText("CHATS BODY")).not.toBeNull();
    // The disabled section's body never mounts.
    expect(screen.queryByText("PROJECTS BODY")).toBeNull();
  });

  it("marks the disabled tab aria-disabled and hides its count", () => {
    renderShelf([chats, projectsDisabled]);
    const projectsTab = screen.getByRole("tab", { name: /Projects/ });
    expect(projectsTab.getAttribute("aria-disabled")).toBe("true");
    expect(projectsTab.textContent ?? "").not.toContain("5");
  });

  it("does not activate the disabled tab on click", () => {
    renderShelf([chats, projectsDisabled]);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    expect(screen.queryByText("PROJECTS BODY")).toBeNull();
    expect(screen.queryByText("CHATS BODY")).not.toBeNull();
  });
});

describe("AgentHomeTab count badge", () => {
  const noCount: AgentHomeShelfSection = {
    id: "nocnt",
    icon: <span />,
    title: "No Count",
    renderBody: () => <div>NO COUNT BODY</div>,
  };
  const zeroCount: AgentHomeShelfSection = {
    id: "zerocnt",
    icon: <span />,
    title: "Zero Count",
    count: 0,
    renderBody: () => <div>ZERO COUNT BODY</div>,
  };

  it("shows no badge when count is undefined", () => {
    renderShelf([noCount]);
    const tab = screen.getByRole("tab", { name: /No Count/ });
    // Only the icon + title text — no numeric suffix.
    expect(tab.textContent?.trim()).toBe("No Count");
  });

  it("shows no badge when count is 0", () => {
    renderShelf([zeroCount]);
    const tab = screen.getByRole("tab", { name: /Zero Count/ });
    expect(tab.textContent?.trim()).toBe("Zero Count");
  });

  it("shows the badge when count is positive", () => {
    renderShelf([chats]);
    const tab = screen.getByRole("tab", { name: /Recent Chats/ });
    expect(tab.textContent).toContain("2");
  });
});

describe("AgentHomeShelf storageKey persistence and fallback", () => {
  const notes: AgentHomeShelfSection = {
    id: "notes",
    icon: <span />,
    title: "Notes",
    renderBody: () => <div>NOTES BODY</div>,
  };

  beforeEach(() => {
    window.localStorage.removeItem(TEST_STORAGE_KEY);
  });

  it("persists the selected tab id to localStorage on click", () => {
    renderShelf([chats, notes], TEST_STORAGE_KEY);
    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }));
    expect(window.localStorage.getItem(TEST_STORAGE_KEY)).toBe("notes");
  });

  it("restores the persisted tab on mount", () => {
    window.localStorage.setItem(TEST_STORAGE_KEY, "notes");
    renderShelf([chats, notes], TEST_STORAGE_KEY);
    expect(screen.queryByText("NOTES BODY")).not.toBeNull();
    expect(screen.queryByText("CHATS BODY")).toBeNull();
  });

  it("falls back to the first selectable tab when the persisted id is absent", () => {
    // "relevant-notes" was persisted but that section is no longer in the list.
    window.localStorage.setItem(TEST_STORAGE_KEY, "relevant-notes");
    renderShelf([chats, notes], TEST_STORAGE_KEY);
    expect(screen.queryByText("CHATS BODY")).not.toBeNull();
    expect(screen.queryByText("NOTES BODY")).toBeNull();
  });
});
