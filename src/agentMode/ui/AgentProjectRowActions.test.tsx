const mockConfirmModals: { onConfirm: () => Promise<void> | void; content: unknown }[] = [];
const mockOpenedEditModals: unknown[] = [];

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, onConfirm, content) => {
    mockConfirmModals.push({ onConfirm, content });
    return { open: jest.fn() };
  }),
}));

jest.mock("@/components/modals/project/AddProjectModal", () => ({
  AddProjectModal: jest.fn().mockImplementation((_app, _onSave, project) => ({
    open: () => mockOpenedEditModals.push(project),
  })),
}));

jest.mock("@/logger", () => ({ ...jest.requireActual("@/logger"), logError: jest.fn() }));
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));

import {
  AgentProjectRowActions,
  AgentProjectRowMenu,
  leaveDeletedProject,
} from "@/agentMode/ui/AgentProjectRowActions";
import { simulateMenuExitAnimation } from "@/agentMode/ui/testing/menuExitAnimation";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import type { ProjectConfig } from "@/aiParams";
import { logError } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App, Notice } from "obsidian";
import React from "react";

const PROJECT = { id: "garden", name: "Garden plans", created: 0 } as ProjectConfig;

function mockFileManager() {
  const manager = {
    setProjectArchived: jest.fn(async () => {}),
    deleteProject: jest.fn(async () => {}),
  };
  jest.mocked(ProjectFileManager.getInstance).mockReturnValue(manager as never);
  return manager;
}

function openMenu(): HTMLElement {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Garden plans" }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.getByRole("menu");
}

function ControlledMenu(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <AgentProjectRowMenu app={new App()} project={PROJECT} open={open} onOpenChange={setOpen} />
  );
}

describe("AgentProjectRowActions", () => {
  beforeAll(installRadixMenuPolyfills);
  beforeEach(() => {
    mockConfirmModals.length = 0;
    mockOpenedEditModals.length = 0;
    jest.mocked(Notice).mockClear();
  });

  describe("AgentProjectRowActions()", () => {
    it("archives the project from the inline Archive button", () => {
      const manager = mockFileManager();
      render(<AgentProjectRowActions app={new App()} project={PROJECT} />);

      fireEvent.click(screen.getByLabelText("Archive project Garden plans"));

      expect(manager.setProjectArchived).toHaveBeenCalledWith("garden", true);
    });

    it("deletes the project and reports it once the confirmation is accepted", async () => {
      const manager = mockFileManager();
      const onDeleted = jest.fn();
      render(<AgentProjectRowActions app={new App()} project={PROJECT} onDeleted={onDeleted} />);

      fireEvent.click(screen.getByLabelText("Delete project Garden plans"));
      await mockConfirmModals[0].onConfirm();

      expect(manager.deleteProject).toHaveBeenCalledWith("garden");
      expect(onDeleted).toHaveBeenCalledWith("garden");
    });
  });

  describe("AgentProjectRowMenu()", () => {
    it("offers Reveal, Edit, Archive and Delete for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      mockFileManager();
      render(<ControlledMenu />);

      const labels = within(openMenu())
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent);

      expect(labels).toEqual([
        "Reveal in vault",
        "Edit project",
        "Archive project",
        "Delete project",
      ]);
    });

    it("opens the edit dialog for the project from the Edit item for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      mockFileManager();
      render(
        <AgentProjectRowMenu app={new App()} project={PROJECT} open onOpenChange={() => {}} />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Edit project" }));

      expect(mockOpenedEditModals).toEqual([PROJECT]);
    });

    it("archives the project from the Archive item for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const manager = mockFileManager();
      render(
        <AgentProjectRowMenu app={new App()} project={PROJECT} open onOpenChange={() => {}} />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Archive project" }));

      expect(manager.setProjectArchived).toHaveBeenCalledWith("garden", true);
    });

    it("tells the user when archiving fails instead of failing silently", async () => {
      const manager = mockFileManager();
      manager.setProjectArchived.mockRejectedValueOnce(new Error("disk full"));
      render(
        <AgentProjectRowMenu app={new App()} project={PROJECT} open onOpenChange={() => {}} />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Archive project" }));
      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith('Failed to archive project "Garden plans".')
      );
    });

    it("deletes the project through the confirmation from the Delete item and reports it", async () => {
      const manager = mockFileManager();
      const onDeleted = jest.fn();
      render(
        <AgentProjectRowMenu
          app={new App()}
          project={PROJECT}
          onDeleted={onDeleted}
          open
          onOpenChange={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));
      await mockConfirmModals[0].onConfirm();

      expect(manager.deleteProject).toHaveBeenCalledWith("garden");
      expect(onDeleted).toHaveBeenCalledWith("garden");
    });

    it("tells the user the folder cannot be revealed when it is not in the vault", () => {
      mockFileManager();
      render(
        <AgentProjectRowMenu app={new App()} project={PROJECT} open onOpenChange={() => {}} />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in vault" }));

      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Garden plans"));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/802 removes the menu as soon as an item is chosen instead of animating it out after Reveal in vault hides its row", () => {
      mockFileManager();
      render(<ControlledMenu />);
      const exitAnimation = simulateMenuExitAnimation();
      try {
        fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Reveal in vault" }));

        expect(document.querySelector('[role="menu"]')).toBeNull();
      } finally {
        exitAnimation.mockRestore();
      }
    });
  });

  describe("leaveDeletedProject()", () => {
    function sessionManager(activeProjectId: string, exit = Promise.resolve()) {
      return { getActiveProjectId: () => activeProjectId, exitProject: jest.fn(() => exit) };
    }

    it("leaves the open project when that project is deleted", () => {
      const manager = sessionManager("garden");

      leaveDeletedProject(manager, "garden");

      expect(manager.exitProject).toHaveBeenCalledTimes(1);
    });

    it("stays in the open project when a different project is deleted", () => {
      const manager = sessionManager("garden");

      leaveDeletedProject(manager, "kitchen");

      expect(manager.exitProject).not.toHaveBeenCalled();
    });

    it("logs a failed exit instead of rejecting", async () => {
      const failure = new Error("exit failed");
      const exit = Promise.reject(failure);
      const manager = sessionManager("garden", exit);

      leaveDeletedProject(manager, "garden");
      await exit.catch(() => undefined);

      expect(logError).toHaveBeenCalledWith("[AgentMode] exit after delete failed", failure);
    });
  });
});
