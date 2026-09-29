import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getCachedProjectRecordById = jest.fn((): ProjectFileRecord | undefined => undefined);
jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: () => getCachedProjectRecordById(),
}));

jest.mock("@/projects/projectPaths", () => ({
  getProjectAnchorFromConfigPath: (configPath: string) => ({
    projectFolderPath: configPath.split("/").slice(0, -1).join("/"),
    projectsRoot: configPath.split("/").slice(0, -2).join("/"),
  }),
}));

const readAgentsFile = jest.fn(async (): Promise<string> => "");
const agentsFileIsUninitialized = jest.fn(async (): Promise<boolean> => true);
const captureInstructionFiles = jest.fn(
  async (_app: unknown, _folder: string): Promise<InstructionFilesSnapshot> => ({
    agents: null,
    claude: null,
  })
);
const restoreInstructionFiles = jest.fn(
  async (_app: unknown, _folder: string, _snapshot: InstructionFilesSnapshot): Promise<void> => {}
);
const writeAgentsFile = jest.fn(
  async (_app: unknown, _folder: string, _content: string): Promise<void> => {}
);
jest.mock("@/instructions/agentsFile", () => ({
  readAgentsFile: () => readAgentsFile(),
  agentsFileIsUninitialized: () => agentsFileIsUninitialized(),
  captureInstructionFiles: (app: unknown, folder: string) => captureInstructionFiles(app, folder),
  restoreInstructionFiles: (app: unknown, folder: string, snapshot: InstructionFilesSnapshot) =>
    restoreInstructionFiles(app, folder, snapshot),
  writeAgentsFile: (app: unknown, folder: string, content: string) =>
    writeAgentsFile(app, folder, content),
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks must keep
   the mocked hooks' exported names. */
jest.mock("@/context", () => ({ useApp: () => ({ vault: {} }) }));
jest.mock("@/utils", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/utils"),
  randomUUID: () => "new-project-id",
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

import {
  AddProjectModalContent,
  type AddProjectModalContentProps,
} from "@/components/modals/project/AddProjectModal";
import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import type { InstructionFilesSnapshot } from "@/instructions/agentsFile";

const PROJECT = {
  id: "proj-1",
  name: "My Research",
  description: "",
  systemPrompt: "Cite only #verified notes.",
  projectModelKey: "",
  modelConfigs: {},
  contextSource: { inclusions: "", exclusions: "", webUrls: "", youtubeUrls: "" },
} as unknown as ProjectConfig;

const PROJECT_FOLDER = "copilot/projects/proj-1";

function renderModal(overrides: Partial<AddProjectModalContentProps> = {}) {
  const onSave = overrides.onSave ?? jest.fn().mockResolvedValue(undefined);
  render(
    <AddProjectModalContent
      initialProject={PROJECT}
      onSave={onSave}
      onCancel={jest.fn()}
      {...overrides}
    />
  );
  return { onSave };
}

function findInstructionsBox(): Promise<HTMLTextAreaElement> {
  return screen.findByLabelText<HTMLTextAreaElement>("Project instructions");
}

describe("AddProjectModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readAgentsFile.mockResolvedValue("");
    agentsFileIsUninitialized.mockResolvedValue(true);
    captureInstructionFiles.mockResolvedValue({ agents: null, claude: null });
    writeAgentsFile.mockResolvedValue(undefined);
    getCachedProjectRecordById.mockReturnValue({
      folderName: "proj-1",
      filePath: `${PROJECT_FOLDER}/project.md`,
      project: PROJECT,
    });
  });

  describe("AddProjectModalContent", () => {
    it("shows legacy project.md instructions, so an upgraded project is not edited blank", async () => {
      renderModal();

      expect((await findInstructionsBox()).value).toBe("Cite only #verified notes.");
    });

    it("writes nothing while the dialog is merely open, so Cancel leaves the project untouched", async () => {
      renderModal();
      await findInstructionsBox();

      expect(writeAgentsFile).not.toHaveBeenCalled();
    });

    it("clears the legacy copy on save, completing the move the editor previewed", async () => {
      const { onSave } = renderModal();
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), PROJECT_FOLDER, "New rules")
      );
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: "" }));
    });

    it("respects an AGENTS.md the user deliberately emptied, rather than resurrecting the legacy text", async () => {
      readAgentsFile.mockResolvedValue("");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();

      expect((await findInstructionsBox()).value).toBe("");

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "Cite only #verified notes." })
      );
    });

    it("keeps the legacy copy when AGENTS.md already had its own body", async () => {
      readAgentsFile.mockResolvedValue("Rules the user wrote directly.");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();
      await findInstructionsBox();

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "Cite only #verified notes." })
      );
    });

    it("restores the folder's instruction files when the project update is rejected", async () => {
      readAgentsFile.mockResolvedValue("Old rules");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const snapshot = { agents: "Old rules", claude: "@AGENTS.md\n" };
      captureInstructionFiles.mockResolvedValue(snapshot);
      const onSave = jest.fn().mockRejectedValue(new Error("A project with that name exists"));
      renderModal({ onSave });
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(restoreInstructionFiles).toHaveBeenCalledWith(
          expect.anything(),
          PROJECT_FOLDER,
          snapshot
        )
      );
    });

    it("offers no instruction field for a project that has no folder yet", async () => {
      getCachedProjectRecordById.mockReturnValue(undefined);
      renderModal({ initialProject: undefined });

      await waitFor(() => expect(screen.getByText("New Project")).toBeTruthy());
      expect(screen.queryByLabelText("Project instructions")).toBeNull();
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
  });
});
