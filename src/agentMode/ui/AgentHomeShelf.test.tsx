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

describe("AgentHomeShelf", () => {
  describe("AgentHomeShelf()", () => {
    it("activates the first selectable section when another section is disabled", () => {
      renderShelf([chats, projectsDisabled]);
      expect(screen.queryByText("CHATS BODY")).not.toBeNull();
      expect(screen.queryByText("PROJECTS BODY")).toBeNull();
    });

    it("marks a disabled tab aria-disabled and hides its count", () => {
      renderShelf([chats, projectsDisabled]);
      const projectsTab = screen.getByRole("tab", { name: /Projects/ });
      expect(projectsTab.getAttribute("aria-disabled")).toBe("true");
      expect(projectsTab.textContent ?? "").not.toContain("5");
    });

    it("keeps the current section active when a disabled tab is clicked", () => {
      renderShelf([chats, projectsDisabled]);
      fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
      expect(screen.queryByText("PROJECTS BODY")).toBeNull();
      expect(screen.queryByText("CHATS BODY")).not.toBeNull();
    });

    it("renders the parent-selected section in controlled mode", () => {
      renderShelf([chats, projectsEnabled], { activeSectionId: "projects" });
      expect(screen.queryByText("PROJECTS BODY")).not.toBeNull();
      expect(screen.queryByText("CHATS BODY")).toBeNull();
    });

    it("falls back to the first selectable section when controlled mode has no selection", () => {
      renderShelf([chats, projectsEnabled], { activeSectionId: null });
      expect(screen.queryByText("CHATS BODY")).not.toBeNull();
    });

    it("reports controlled clicks without switching sections until the parent updates", () => {
      const onSectionSelect = jest.fn();
      renderShelf([chats, projectsEnabled], { activeSectionId: "chats", onSectionSelect });
      fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
      expect(onSectionSelect).toHaveBeenCalledWith("projects");
      expect(screen.queryByText("CHATS BODY")).not.toBeNull();
      expect(screen.queryByText("PROJECTS BODY")).toBeNull();
    });

    it("renders Recent Chats without a cumulative count when the caller omits it", () => {
      renderShelf([chats]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").not.toMatch(/\d/);
    });

    it("hides the count badge when the count is zero", () => {
      renderShelf([withCount(0)]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").not.toContain(
        "0"
      );
    });

    it("shows the count badge when the count is positive", () => {
      renderShelf([withCount(3)]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").toContain("3");
    });
  });
});

function withCount(count?: number): AgentHomeShelfSection {
  return {
    id: "chats",
    icon: <span />,
    title: "Recent Chats",
    count,
    renderBody: () => <div>CHATS BODY</div>,
  };
}
