const mockConfirmModals: { onConfirm: () => Promise<void> | void; content: unknown }[] = [];

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, onConfirm, content) => {
    mockConfirmModals.push({ onConfirm, content });
    return { open: jest.fn() };
  }),
}));

jest.mock("@/logger", () => ({ ...jest.requireActual("@/logger"), logError: jest.fn() }));
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));

import { AgentProjectRowActions, leaveDeletedProject } from "@/projects/ui/AgentProjectRowActions";
import type { ProjectConfig } from "@/aiParams";
import { logError } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const PROJECT = { id: "garden", name: "Garden plans" } as ProjectConfig;

function mockFileManager() {
  const manager = {
    setProjectArchived: jest.fn(async () => {}),
    deleteProject: jest.fn(async () => {}),
  };
  jest.mocked(ProjectFileManager.getInstance).mockReturnValue(manager as never);
  return manager;
}

describe("AgentProjectRowActions", () => {
  beforeEach(() => {
    mockConfirmModals.length = 0;
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
