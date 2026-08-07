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

const moveProjectPromptToAgentsFile = jest.fn(
  async (_app: unknown, _record: ProjectFileRecord): Promise<void> => {}
);
jest.mock("@/projects/moveProjectPrompt", () => ({
  moveProjectPromptToAgentsFile: (app: unknown, record: ProjectFileRecord) =>
    moveProjectPromptToAgentsFile(app, record),
}));

const readAgentsFile = jest.fn(async (): Promise<string> => "");
const writeAgentsFile = jest.fn(
  async (_app: unknown, _folder: string, _content: string): Promise<void> => {}
);
jest.mock("@/instructions/agentsFile", () => ({
  readAgentsFile: () => readAgentsFile(),
  writeAgentsFile: (app: unknown, folder: string, content: string) =>
    writeAgentsFile(app, folder, content),
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks must keep
   the mocked hooks' exported names. */
jest.mock("@/context", () => ({ useApp: () => ({ vault: {} }) }));
jest.mock("@/utils", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/utils"),
  // jsdom's crypto has no randomUUID; a new project mints its id at mount.
  randomUUID: () => "new-project-id",
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  useChatBackendModelOptions: () => ({ options: [], resolveSelectionId: (id: string) => id }),
}));
jest.mock("@/components/project/useProjectProcessingData", () => ({
  useProjectProcessingData: () => ({
    processingData: null,
    projectCache: null,
    isCurrentProject: false,
  }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

import {
  AddProjectModalContent,
  type AddProjectModalContentProps,
} from "@/components/modals/project/AddProjectModal";
import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";

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
      agentMode
      {...overrides}
    />
  );
  return { onSave };
}

/** The instruction field only mounts once the AGENTS.md draft has settled. */
function findInstructionsBox(): Promise<HTMLTextAreaElement> {
  return screen.findByLabelText<HTMLTextAreaElement>("Project instructions");
}

describe("AddProjectModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readAgentsFile.mockResolvedValue("");
    writeAgentsFile.mockResolvedValue(undefined);
    moveProjectPromptToAgentsFile.mockResolvedValue(undefined);
    getCachedProjectRecordById.mockReturnValue({
      folderName: "proj-1",
      filePath: `${PROJECT_FOLDER}/project.md`,
      project: PROJECT,
    });
  });

  describe("AddProjectModalContent", () => {
    it("moves legacy project.md instructions in before showing the field, so an upgraded project is not edited blank", async () => {
      // The move is what puts the text into AGENTS.md; reading first would show an empty box
      // over instructions that are still live in `project.md`.
      moveProjectPromptToAgentsFile.mockImplementation(async () => {
        readAgentsFile.mockResolvedValue("Cite only #verified notes.");
      });
      renderModal();

      const box = await findInstructionsBox();
      expect(box.value).toBe("Cite only #verified notes.");
      expect(moveProjectPromptToAgentsFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filePath: `${PROJECT_FOLDER}/project.md` })
      );
    });

    it("writes the edited instructions to the project's own folder on save", async () => {
      renderModal();
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), PROJECT_FOLDER, "New rules")
      );
    });

    it("restores the previous instructions when the project update is rejected", async () => {
      // A rejected update leaves the dialog open and cancelable, so the file must not keep an
      // edit the user can still back out of.
      readAgentsFile.mockResolvedValue("Old rules");
      const onSave = jest.fn().mockRejectedValue(new Error("A project with that name exists"));
      renderModal({ onSave });
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(writeAgentsFile).toHaveBeenLastCalledWith(
          expect.anything(),
          PROJECT_FOLDER,
          "Old rules"
        )
      );
    });

    it("offers no instruction field for a project that has no folder yet", async () => {
      // Nothing to read or migrate before the project exists, and nowhere to put a draft.
      getCachedProjectRecordById.mockReturnValue(undefined);
      renderModal({ initialProject: undefined });

      await waitFor(() => expect(screen.getByText("New Project")).toBeTruthy());
      expect(screen.queryByLabelText("Project instructions")).toBeNull();
      expect(moveProjectPromptToAgentsFile).not.toHaveBeenCalled();
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
  });
});
