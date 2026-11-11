import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentProjectHeader } from "@/projects/ui/AgentProjectHeader";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function renderHeader(props: Partial<React.ComponentProps<typeof AgentProjectHeader>> = {}) {
  const onOpenHome = jest.fn();
  const onExit = props.onExit ?? jest.fn();
  const onOpenSettings = jest.fn();
  const onRevealFolder = jest.fn();
  const menu = "menu" in props ? props.menu : <button type="button" aria-label="Project options" />;
  render(
    <TooltipProvider>
      <AgentProjectHeader
        projectName={props.projectName ?? "Demo"}
        onOpenHome={onOpenHome}
        onExit={onExit}
        onOpenSettings={onOpenSettings}
        onRevealFolder={onRevealFolder}
        menu={menu}
        isProjectHome={props.isProjectHome}
        orphaned={props.orphaned}
      />
    </TooltipProvider>
  );
  return { onOpenHome, onExit, onOpenSettings, onRevealFolder };
}

describe("AgentProjectHeader", () => {
  describe("AgentProjectHeader()", () => {
    it("shows the live project name", () => {
      renderHeader({ projectName: "My Research" });
      expect(screen.getByText("My Research")).toBeTruthy();
    });

    it("goes to the project home when the project name is clicked", () => {
      const { onOpenHome, onExit } = renderHeader({ projectName: "My Research" });
      fireEvent.click(screen.getByRole("button", { name: "Go to My Research home" }));
      expect(onOpenHome).toHaveBeenCalledTimes(1);
      expect(onExit).not.toHaveBeenCalled();
    });

    it("offers no way to leave the project while the project exists", () => {
      renderHeader();
      expect(screen.queryByRole("button", { name: "Leave project" })).toBeNull();
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

    it("shows settings and reveal but not the given menu on the project home, for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      renderHeader({ isProjectHome: true });

      expect(
        screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
      ).toEqual(["Go to Demo home", "Project settings", "Reveal project folder in vault"]);
    });

    it("shows the given menu after settings and reveal in a project chat, for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      renderHeader({ isProjectHome: false });

      expect(
        screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
      ).toEqual([
        "Go to Demo home",
        "Project settings",
        "Reveal project folder in vault",
        "Project options",
      ]);
    });

    it("renders the provided options menu in the trailing slot", () => {
      renderHeader({ menu: <button type="button" aria-label="Project options" /> });
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it("offers only Leave project when the project is orphaned", () => {
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
