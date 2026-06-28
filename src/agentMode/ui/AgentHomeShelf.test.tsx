import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// The tooltip portal targets Obsidian's `activeDocument` global (popout-safe);
// jsdom has no such global, so point it at the test document.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function renderShelf(
  sections: AgentHomeShelfSection[],
  controlled?: { activeSectionId: string | null; onSectionSelect?: (id: string) => void }
) {
  return render(
    <TooltipProvider>
      <AgentHomeShelf sections={sections} {...controlled} />
    </TooltipProvider>
  );
}

const projectsEnabled: AgentHomeShelfSection = {
  id: "projects",
  icon: <span />,
  title: "Projects",
  count: 5,
  renderBody: () => <div>PROJECTS BODY</div>,
};

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

describe("AgentHomeShelf controlled mode", () => {
  it("renders the parent-selected section's body", () => {
    renderShelf([chats, projectsEnabled], { activeSectionId: "projects" });
    expect(screen.queryByText("PROJECTS BODY")).not.toBeNull();
    expect(screen.queryByText("CHATS BODY")).toBeNull();
  });

  it("falls back to the first selectable section when nothing is picked yet (null)", () => {
    renderShelf([chats, projectsEnabled], { activeSectionId: null });
    expect(screen.queryByText("CHATS BODY")).not.toBeNull();
  });

  it("reports clicks via onSectionSelect instead of switching on its own", () => {
    const onSectionSelect = jest.fn();
    renderShelf([chats, projectsEnabled], { activeSectionId: "chats", onSectionSelect });
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    expect(onSectionSelect).toHaveBeenCalledWith("projects");
    // Controlled: the body only changes when the parent updates the prop.
    expect(screen.queryByText("CHATS BODY")).not.toBeNull();
    expect(screen.queryByText("PROJECTS BODY")).toBeNull();
  });
});
