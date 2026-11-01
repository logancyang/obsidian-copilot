import {
  AgentHomeShelf,
  landingSectionsForSidebar,
  type AgentHomeShelfSection,
} from "@/agentMode/ui/AgentHomeShelf";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

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

    it("restores the remembered Relevant Notes tab after temporary pane suppression — https://github.com/Brevilabs/obsidian-copilot-private/issues/468", () => {
      const relevantNotes: AgentHomeShelfSection = {
        id: "relevant-notes",
        icon: <span />,
        title: "Relevant Notes",
        renderBody: () => <div>RELEVANT NOTES BODY</div>,
      };
      const onSectionSelect = jest.fn();
      const shelf = (sections: AgentHomeShelfSection[]) => (
        <TooltipProvider>
          <AgentHomeShelf
            sections={sections}
            activeSectionId="relevant-notes"
            onSectionSelect={onSectionSelect}
          />
        </TooltipProvider>
      );
      const { rerender } = render(shelf([chats, relevantNotes]));
      expect(screen.queryByText("RELEVANT NOTES BODY")).not.toBeNull();

      rerender(shelf([chats]));
      expect(screen.queryByText("RELEVANT NOTES BODY")).toBeNull();
      expect(screen.queryByText("CHATS BODY")).not.toBeNull();

      rerender(shelf([chats, relevantNotes]));
      expect(screen.queryByText("RELEVANT NOTES BODY")).not.toBeNull();
      expect(screen.queryByText("CHATS BODY")).toBeNull();
      expect(onSectionSelect).not.toHaveBeenCalled();
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
      renderShelf([chats, projectsEnabled]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").not.toMatch(/\d/);
    });

    it("uses the shared ten-row viewport for every section body", () => {
      renderShelf([chats, projectsEnabled]);
      const panel = screen.getByRole("tabpanel");
      const panelBody = panel.firstElementChild as HTMLElement;

      expect(panel.classList.contains("tw-h-96")).toBe(true);
      expect(panel.classList.contains("tw-max-h-96")).toBe(true);
      expect(panel.classList.contains("tw-overflow-y-auto")).toBe(true);
      expect(panelBody.classList.contains("tw-h-full")).toBe(true);
      expect(panelBody.classList.contains("tw-min-h-full")).toBe(true);

      fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
      expect(screen.getByRole("tabpanel")).toBe(panel);
      expect(screen.queryByText("PROJECTS BODY")).not.toBeNull();
    });

    it("shows a lone section's body without a tab bar, so a single tab never stands alone — https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      renderShelf([chats]);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.getByRole("region", { name: "Recent Chats" }).textContent).toContain(
        "CHATS BODY"
      );
    });

    it("hides the count badge when the count is zero", () => {
      renderShelf([withCount(0), projectsEnabled]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").not.toContain(
        "0"
      );
    });

    it("shows the count badge when the count is positive", () => {
      renderShelf([withCount(3), projectsEnabled]);
      expect(screen.getByRole("tab", { name: /Recent Chats/ }).textContent ?? "").toContain("3");
    });
  });

  describe("landingSectionsForSidebar()", () => {
    const relevantNotes: AgentHomeShelfSection = {
      id: "relevant-notes",
      icon: <span />,
      title: "Relevant Notes",
      renderBody: () => <div>NOTES BODY</div>,
    };

    it("keeps every landing section while the sessions sidebar is closed", () => {
      const sections = [chats, projectsEnabled, relevantNotes];

      expect(landingSectionsForSidebar(sections, false)).toBe(sections);
    });

    it("keeps only Relevant Notes while the sessions sidebar is open, since the sidebar lists chats and projects — https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      expect(
        landingSectionsForSidebar([chats, projectsEnabled, relevantNotes], true).map((s) => s.id)
      ).toEqual(["relevant-notes"]);
    });

    it("leaves no sections while the sessions sidebar is open and Relevant Notes is absent — https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      expect(landingSectionsForSidebar([chats, projectsEnabled], true)).toEqual([]);
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
