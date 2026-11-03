import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import {
  AgentProjectCreateForm,
  createProjectAndEnter,
  makeNewProjectConfig,
} from "@/agentMode/ui/AgentProjectCreateForm";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import type { App } from "obsidian";

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: jest.fn() },
}));
jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

beforeAll(() => {
  const cryptoObj = window.crypto as { randomUUID?: () => string };
  if (typeof cryptoObj.randomUUID !== "function") {
    let counter = 0;
    cryptoObj.randomUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  }
});

function renderForm(props: Partial<React.ComponentProps<typeof AgentProjectCreateForm>> = {}) {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  const onCancel = props.onCancel ?? jest.fn();
  render(<AgentProjectCreateForm {...props} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}
describe("AgentProjectCreateForm", () => {
  describe("AgentProjectCreateForm()", () => {
    it("disables Create until a name is entered", () => {
      renderForm();
      const create = screen.getByText("Create").closest("button") as HTMLButtonElement;
      expect(create.disabled).toBe(true);

      fireEvent.change(screen.getByPlaceholderText("Project name"), {
        target: { value: "  Research  " },
      });
      expect(create.disabled).toBe(false);
    });

    it("saves the trimmed name", async () => {
      const { onSave } = renderForm();
      fireEvent.change(screen.getByPlaceholderText("Project name"), {
        target: { value: "  Research  " },
      });
      fireEvent.click(screen.getByText("Create"));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "Research" }));
    });

    it("submits on Enter from the name field", async () => {
      const { onSave } = renderForm();
      const input = screen.getByPlaceholderText("Project name");
      fireEvent.change(input, { target: { value: "Research" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "Research" }));
    });

    it("cancels without saving", () => {
      const { onCancel, onSave } = renderForm();
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe("makeNewProjectConfig()", () => {
    it("builds a name-only config with the Agent-Mode-empty defaults", () => {
      const project = makeNewProjectConfig("Research");
      expect(project.name).toBe("Research");
      expect(project.systemPrompt).toBe("");
      expect(project.contextSource).toEqual({
        inclusions: "",
        exclusions: "",
        webUrls: "",
        youtubeUrls: "",
      });
      expect(project.created).toBe(project.UsageTimestamps);
      expect(typeof project.created).toBe("number");
    });

    it("assigns a unique id per call", () => {
      expect(makeNewProjectConfig("A").id).not.toBe(makeNewProjectConfig("A").id);
    });
  });

  describe("createProjectAndEnter()", () => {
    const app = {} as App;
    const buildManager = () => ({ enterProject: jest.fn().mockResolvedValue(undefined) });
    const mockCreateProject = (createProject: jest.Mock) =>
      jest.mocked(ProjectFileManager.getInstance).mockReturnValue({ createProject } as never);

    it("creates the named project and then opens it in the chat view", async () => {
      const createProject = jest.fn().mockResolvedValue(undefined);
      mockCreateProject(createProject);
      const manager = buildManager();

      await createProjectAndEnter(app, manager as unknown as AgentSessionManager, "Research");

      const created = createProject.mock.calls[0][0];
      expect(created.name).toBe("Research");
      expect(manager.enterProject).toHaveBeenCalledWith(created.id);
    });

    it("rethrows the creation error and does not open a project", async () => {
      mockCreateProject(
        jest.fn().mockRejectedValue(new Error('A project with the name "Research" already exists'))
      );
      const manager = buildManager();

      await expect(
        createProjectAndEnter(app, manager as unknown as AgentSessionManager, "Research")
      ).rejects.toThrow('A project with the name "Research" already exists');
      expect(manager.enterProject).not.toHaveBeenCalled();
    });
  });
});
