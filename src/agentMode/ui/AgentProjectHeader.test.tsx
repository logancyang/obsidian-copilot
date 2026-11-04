import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function renderHeader(props: Partial<React.ComponentProps<typeof AgentProjectHeader>> = {}) {
  const onExit = props.onExit ?? jest.fn();
  const onOpenSettings = jest.fn();
  const onRevealFolder = jest.fn();
  const menu = "menu" in props ? props.menu : <button type="button" aria-label="Project options" />;
  render(
    <TooltipProvider>
      <AgentProjectHeader
        projectName={props.projectName ?? "Demo"}
        onExit={onExit}
        onOpenSettings={onOpenSettings}
        onRevealFolder={onRevealFolder}
        menu={menu}
        orphaned={props.orphaned}
        canLeaveProject={props.canLeaveProject}
      />
    </TooltipProvider>
  );
  return { onExit, onOpenSettings, onRevealFolder };
}

describe("AgentProjectHeader", () => {
  describe("AgentProjectHeader()", () => {
    it("shows the live project name", () => {
      renderHeader({ projectName: "My Research" });
      expect(screen.getByText("My Research")).toBeTruthy();
    });

    it("exits the project when the back affordance is clicked", () => {
      const { onExit } = renderHeader();
      fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("hides the leave button when leaving the project is not allowed, keeping the project name and menu, for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      renderHeader({ projectName: "Research", canLeaveProject: false });

      expect(screen.queryByRole("button", { name: "Leave project" })).toBeNull();
      expect(screen.getByText("Research")).toBeTruthy();
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it("opens project settings from the settings button for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      const { onOpenSettings, onRevealFolder } = renderHeader({ menu: undefined });

      fireEvent.click(screen.getByRole("button", { name: "Project settings" }));

      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(onRevealFolder).not.toHaveBeenCalled();
    });

    it("reveals the project folder from the reveal button for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      const { onOpenSettings, onRevealFolder } = renderHeader({ menu: undefined });

      fireEvent.click(screen.getByRole("button", { name: "Reveal project folder in vault" }));

      expect(onRevealFolder).toHaveBeenCalledTimes(1);
      expect(onOpenSettings).not.toHaveBeenCalled();
    });

    it("shows only settings and reveal without a menu, and the menu after them when given, for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      const labels = () =>
        screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
      const { unmount } = render(
        <TooltipProvider>
          <AgentProjectHeader
            projectName="Demo"
            onExit={jest.fn()}
            onOpenSettings={jest.fn()}
            onRevealFolder={jest.fn()}
            canLeaveProject={false}
          />
        </TooltipProvider>
      );
      expect(labels()).toEqual(["Project settings", "Reveal project folder in vault"]);
      unmount();

      renderHeader({ canLeaveProject: false });
      expect(labels()).toEqual([
        "Project settings",
        "Reveal project folder in vault",
        "Project options",
      ]);
    });

    it("renders the provided options menu in the trailing slot", () => {
      renderHeader({ menu: <button type="button" aria-label="Project options" /> });
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it("degrades to an escape hatch when the project is orphaned", () => {
      const { onExit } = renderHeader({ projectName: "Gone", orphaned: true });
      expect(screen.queryByText("Gone")).toBeNull();
      expect(screen.queryByLabelText("Project options")).toBeNull();
      expect(screen.queryByRole("button", { name: "Project settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reveal project folder in vault" })).toBeNull();
      expect(screen.getByText("This project no longer exists")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });
});
