import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

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
  getProjectFolderPath: (folderName: string) => `copilot/projects/${folderName}`,
}));

// Keep the edit/reveal collaborators inert — exercised elsewhere.
jest.mock("@/components/modals/project/AddProjectModal", () => ({
  AddProjectModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
const revealProjectFolder = jest.fn();
jest.mock("@/agentMode/ui/AgentProjectRowActions", () => ({
  revealProjectFolder: (...args: unknown[]) => revealProjectFolder(...args),
}));
const openSystemPromptModal = jest.fn();
jest.mock("@/agentMode/ui/ProjectSystemPromptModal", () => ({
  ProjectSystemPromptModal: jest.fn().mockImplementation((...args: unknown[]) => {
    openSystemPromptModal(...args);
    return { open: jest.fn() };
  }),
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

// A marker line a generated AGENTS.md mirror carries (see ensureAgentsMirror.ts) — a read
// returning this means "generated, hide it". Ownership keys off the stable
// `MIRROR_MARKER_PREFIX`, not the exact wording, so this older-tail variant is still detected;
// keeping it here doubles as a backward tail-compat check.
const MIRROR_MARKER =
  "<!-- copilot:generated-agents-mirror v1 — DO NOT EDIT. Mirror of this project's instructions " +
  "(project.md); regenerated each session. Delete this line to take over the file. -->";

function renderPopover(
  todoList: AgentTodoListEntry[] | null,
  folderNames: string[] = [],
  fileContents: Record<string, string> = {}
) {
  getCachedProjectRecordById.mockReturnValue({ folderName: "proj-1" });
  const openFile = jest.fn().mockResolvedValue(undefined);
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(makeFolder(folderNames)),
      read: jest.fn((file: TFile) => Promise.resolve(fileContents[file.name] ?? "")),
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

  it("renders the project name and the System Prompt row (never the backing file)", async () => {
    renderPopover(null, ["project.md", "AGENTS.md", "notes.md"]);
    expect(screen.getAllByText("My Research").length).toBeGreaterThan(0);
    // Await the async file listing so its setState settles inside act().
    expect(await screen.findByText("System Prompt")).toBeTruthy();
  });

  it("omits the Progress section when there is no todo list", async () => {
    renderPopover(null);
    expect(await screen.findByText("System Prompt")).toBeTruthy();
    expect(screen.queryByText("Progress")).toBeNull();
  });

  it("renders the todo list with a completed/total count when present", async () => {
    renderPopover([
      { content: "step A", status: "completed" },
      { content: "step B", status: "in_progress" },
      { content: "step C", status: "pending" },
    ]);
    await screen.findByText("System Prompt");
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByText("step A")).toBeTruthy();
    expect(screen.getByText("step C")).toBeTruthy();
  });

  it("lists folder files but excludes project.md and a GENERATED AGENTS.md mirror", async () => {
    renderPopover(null, ["project.md", "AGENTS.md", "guide.pdf", "draft.md"], {
      "AGENTS.md": `${MIRROR_MARKER}\n\nbe helpful`, // marker → generated mirror
    });
    expect(await screen.findByText("guide.pdf")).toBeTruthy();
    expect(screen.getByText("draft.md")).toBeTruthy();
    expect(screen.queryByText("project.md")).toBeNull();
    expect(screen.queryByText("AGENTS.md")).toBeNull();
  });

  it("KEEPS a user-authored AGENTS.md (no marker) in the file list", async () => {
    renderPopover(null, ["project.md", "AGENTS.md", "draft.md"], {
      "AGENTS.md": "my own agent rules", // no marker → user-authored, must show
    });
    expect(await screen.findByText("AGENTS.md")).toBeTruthy();
    expect(screen.getByText("draft.md")).toBeTruthy();
    expect(screen.queryByText("project.md")).toBeNull();
  });

  it("keeps an AGENTS.md visible when its content cannot be read", async () => {
    getCachedProjectRecordById.mockReturnValue({ folderName: "proj-1" });
    const app = {
      vault: {
        getAbstractFileByPath: jest.fn().mockReturnValue(makeFolder(["AGENTS.md", "draft.md"])),
        read: jest.fn().mockRejectedValue(new Error("read failed")),
      },
      workspace: { getLeaf: jest.fn().mockReturnValue({ openFile: jest.fn() }) },
    } as unknown as Parameters<typeof ProjectInfoPopover>[0]["app"];
    render(<ProjectInfoPopover app={app} project={PROJECT} todoList={null} />);
    fireEvent.click(screen.getByLabelText("Project info for My Research"));
    // Read failure must not hide a possibly-user file.
    expect(await screen.findByText("AGENTS.md")).toBeTruthy();
  });

  it("opens the System Prompt editor when the row is clicked", async () => {
    renderPopover(null);
    fireEvent.click(await screen.findByText("System Prompt"));
    expect(openSystemPromptModal).toHaveBeenCalledTimes(1);
    // (app, initialPrompt, persistFn)
    expect(openSystemPromptModal.mock.calls[0][1]).toBe("be helpful");
  });

  it("reveals the project folder from the header button", async () => {
    renderPopover(null);
    await screen.findByText("System Prompt");
    fireEvent.click(screen.getByLabelText("Reveal project folder in vault"));
    expect(revealProjectFolder).toHaveBeenCalledWith(expect.anything(), PROJECT);
  });
});
