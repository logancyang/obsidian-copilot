import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// activeDocument global (Radix popover portals into it).
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

const updateProject = jest.fn().mockResolvedValue({ project: {} });
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ updateProject }) },
}));

const getCachedProjectRecordById = jest.fn();
jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: (...args: unknown[]) => getCachedProjectRecordById(...args),
}));

jest.mock("@/projects/projectPaths", () => ({
  getProjectAnchorFromConfigPath: (configPath: string) => ({
    projectFolderPath: configPath.split("/").slice(0, -1).join("/"),
    projectsRoot: configPath.split("/").slice(0, -2).join("/"),
  }),
}));
// Keep the edit/reveal collaborators inert — exercised elsewhere.
jest.mock("@/components/modals/project/AddProjectModal", () => ({
  AddProjectModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
const revealProjectFolder = jest.fn();
jest.mock("@/agentMode/ui/AgentProjectRowActions", () => ({
  revealProjectFolder: (...args: unknown[]) => revealProjectFolder(...args),
}));
const openAgentsFile = jest.fn().mockResolvedValue(undefined);
jest.mock("@/instructions/agentsFile", () => ({
  openAgentsFile: (...args: unknown[]) => openAgentsFile(...args),
  // Real predicate: CLAUDE.md visibility below asserts on its actual behavior.
  isClaudeImportOnly: jest.requireActual("@/instructions/agentsFile").isClaudeImportOnly,
}));
const moveProjectPromptToAgentsFile = jest.fn().mockResolvedValue(undefined);
jest.mock("@/projects/moveProjectPrompt", () => ({
  moveProjectPromptToAgentsFile: (...args: unknown[]) => moveProjectPromptToAgentsFile(...args),
}));

import { TFile, TFolder } from "obsidian";
import { ProjectInfoPopover } from "@/agentMode/ui/ProjectInfoPopover";
import type { AgentTodoListEntry } from "@/agentMode/session/types";
import type { ProjectConfig } from "@/aiParams";

const PROJECT = {
  id: "proj-1",
  name: "My Research",
  systemPrompt: "be helpful",
  contextSource: {},
} as unknown as ProjectConfig;

function makeFolder(names: string[]) {
  const folder = new (TFolder as unknown as new (path: string) => TFolder)(
    "copilot/projects/proj-1"
  );
  (folder as unknown as { children: unknown[] }).children = names.map(
    (n) => new (TFile as unknown as new (path: string) => TFile)(`copilot/projects/proj-1/${n}`)
  );
  return folder;
}

function renderPopover(
  todoList: AgentTodoListEntry[] | null,
  folderNames: string[] = [],
  fileContents: Record<string, string> = {}
) {
  // The popover resolves the folder from the record's own config path, so the record must
  // carry one — the live projects root is deliberately not consulted.
  getCachedProjectRecordById.mockReturnValue({
    folderName: "proj-1",
    filePath: "copilot/projects/proj-1/project.md",
    project: PROJECT,
  });
  const openFile = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(makeFolder(folderNames)),
      read: jest.fn(async (file: TFile) => fileContents[file.path.split("/").pop() ?? ""] ?? ""),
    },
    workspace: { getLeaf: jest.fn().mockReturnValue({ openFile }) },
  } as unknown as Parameters<typeof ProjectInfoPopover>[0]["app"];
  render(<ProjectInfoPopover app={app} project={PROJECT} todoList={todoList} />);
  // Open the popover.
  fireEvent.click(screen.getByLabelText("Project info for My Research"));
  return { openFile };
}

describe("ProjectInfoPopover", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the project name and canonical AGENTS.md row", async () => {
    renderPopover(null, ["project.md", "AGENTS.md", "notes.md"]);
    expect(screen.getAllByText("My Research").length).toBeGreaterThan(0);
    expect(await screen.findByText("AGENTS.md")).toBeTruthy();
  });

  it("omits the Progress section when there is no todo list", async () => {
    renderPopover(null);
    expect(await screen.findByText("AGENTS.md")).toBeTruthy();
    expect(screen.queryByText("Progress")).toBeNull();
  });

  it("renders the todo list with a completed/total count when present", async () => {
    renderPopover([
      { content: "step A", status: "completed" },
      { content: "step B", status: "in_progress" },
      { content: "step C", status: "pending" },
    ]);
    await screen.findByText("AGENTS.md");
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByText("step A")).toBeTruthy();
    expect(screen.getByText("step C")).toBeTruthy();
  });

  it("hides a CLAUDE.md that is only Copilot's @AGENTS.md wiring", async () => {
    renderPopover(null, ["CLAUDE.md", "draft.md"], { "CLAUDE.md": "@AGENTS.md\n" });
    expect(await screen.findByText("draft.md")).toBeTruthy();
    expect(screen.queryByText("CLAUDE.md")).toBeNull();
  });

  it("lists a CLAUDE.md that carries the user's own rules", async () => {
    // Claude reads that content as live instructions, so the file must stay reachable.
    renderPopover(null, ["CLAUDE.md", "draft.md"], {
      "CLAUDE.md": "# My rules\nAlways answer in French.\n\n@AGENTS.md\n",
    });
    expect(await screen.findByText("CLAUDE.md")).toBeTruthy();
  });

  it("lists folder files but excludes project.md and a duplicate AGENTS.md row", async () => {
    renderPopover(null, ["project.md", "AGENTS.md", "guide.pdf", "draft.md"]);
    expect(await screen.findByText("guide.pdf")).toBeTruthy();
    expect(screen.getByText("draft.md")).toBeTruthy();
    expect(screen.queryByText("project.md")).toBeNull();
    expect(screen.getAllByText("AGENTS.md")).toHaveLength(1);
  });

  it("moves any legacy project.md text in before opening the file", async () => {
    renderPopover(null);
    fireEvent.click(await screen.findByText("AGENTS.md"));

    await waitFor(() => expect(openAgentsFile).toHaveBeenCalled());
    expect(moveProjectPromptToAgentsFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ folderName: "proj-1" })
    );
    // Empty content: the move already put the real text on disk, and this must never
    // overwrite a file the user wrote themselves.
    expect(openAgentsFile).toHaveBeenCalledWith(
      expect.anything(),
      "copilot/projects/proj-1",
      "",
      true
    );
  });

  it("reveals the project folder from the header button", async () => {
    renderPopover(null);
    await screen.findByText("AGENTS.md");
    fireEvent.click(screen.getByLabelText("Reveal project folder in vault"));
    expect(revealProjectFolder).toHaveBeenCalledWith(expect.anything(), PROJECT);
  });
});
