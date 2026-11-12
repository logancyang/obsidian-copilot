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
        navigatorOpen={props.navigatorOpen}
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

    it("leaves the project from the Back button while the chat tabs show, since nothing else there leads to the Agent Chat home — https://github.com/Brevilabs/obsidian-copilot-private/issues/916", () => {
      const { onExit, onOpenHome } = renderHeader({ projectName: "My Research" });

      fireEvent.click(screen.getByRole("button", { name: "Leave project" }));

      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onOpenHome).not.toHaveBeenCalled();
    });

    it("shows the project name as plain text that cannot be clicked while the chat tabs show — https://github.com/Brevilabs/obsidian-copilot-private/issues/916", () => {
      const { onOpenHome, onExit } = renderHeader({ projectName: "My Research" });

      fireEvent.click(screen.getByText("My Research"));

      expect(screen.queryByRole("button", { name: "Go to My Research home" })).toBeNull();
      expect(onOpenHome).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
    });

    it("goes to the project home when the project name is clicked while the Navigator is open — https://github.com/Brevilabs/obsidian-copilot-private/issues/916", () => {
      const { onOpenHome, onExit } = renderHeader({
        projectName: "My Research",
        navigatorOpen: true,
      });

      fireEvent.click(screen.getByRole("button", { name: "Go to My Research home" }));

      expect(onOpenHome).toHaveBeenCalledTimes(1);
      expect(onExit).not.toHaveBeenCalled();
    });

    it("has no Back button while the Navigator is open, because the Navigator leads out of the project — https://github.com/Brevilabs/obsidian-copilot-private/issues/916", () => {
      renderHeader({ navigatorOpen: true });

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
      ).toEqual(["Leave project", "Project settings", "Reveal project folder in vault"]);
    });

    it("shows the given menu after settings and reveal in a project chat, for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      renderHeader({ isProjectHome: false });

      expect(
        screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
      ).toEqual([
        "Leave project",
        "Project settings",
        "Reveal project folder in vault",
        "Project options",
      ]);
    });

    it("renders the provided options menu in the trailing slot", () => {
      renderHeader({ menu: <button type="button" aria-label="Project options" /> });
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it.each([
      ["the chat tabs show", false],
      ["the Navigator is open", true],
    ])(
      "offers only Leave project when the project is orphaned and %s",
      (_layout, navigatorOpen) => {
        const { onExit } = renderHeader({ projectName: "Gone", orphaned: true, navigatorOpen });
        expect(screen.queryByText("Gone")).toBeNull();
        expect(screen.queryByLabelText("Project options")).toBeNull();
        expect(screen.queryByRole("button", { name: "Project settings" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Reveal project folder in vault" })).toBeNull();
        expect(screen.getByText("This project no longer exists")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
        expect(onExit).toHaveBeenCalledTimes(1);
      }
    );
  });
});
