const mockConfirmModals: { onConfirm: () => Promise<void> | void; content: unknown }[] = [];

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation((_app, onConfirm, content) => {
    mockConfirmModals.push({ onConfirm, content });
    return { open: jest.fn() };
  }),
}));

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));

import { AgentProjectRowActions } from "@/agentMode/ui/AgentProjectRowActions";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import type { ProjectConfig } from "@/aiParams";
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
});
