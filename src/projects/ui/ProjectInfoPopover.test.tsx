import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";
import type { AgentChatMessage, TurnFileChange } from "@/agentMode/session/types";
import { ProjectInfoPanel, ProjectInfoPopover } from "@/projects/ui/ProjectInfoPopover";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import type { ProjectConfig } from "@/aiParams";
import { AppContext } from "@/context";
import { updateCachedProjectRecords } from "@/projects/state";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App, EventRef, TAbstractFile, TFile, TFolder } from "obsidian";
import React from "react";

const PROJECT_FOLDER = "copilot/projects/Q4 Launch";

const PROJECT: ProjectConfig = {
  id: "q4",
  name: "Q4 Launch",
  systemPrompt: "",
  contextSource: {},
  created: 0,
  UsageTimestamps: 0,
};

function change(path: string, before: string | null, after: string | null): TurnFileChange {
  const built = buildTurnFileChange(path, before, after);
  if (!built) throw new Error(`no change for ${path}`);
  return built;
}

function turn(id: string, fileChanges?: TurnFileChange[]): AgentChatMessage {
  return { id, sender: "ai", timestamp: null, isVisible: true, message: "", fileChanges };
}

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeFolder(path: string, children: TAbstractFile[]): TFolder {
  const folder = new (TFolder as unknown as new (path: string) => TFolder)(path);
  (folder as unknown as { children: TAbstractFile[] }).children = children;
  return folder;
}

function setProjectFolder(folderPath: string): void {
  updateCachedProjectRecords([
    {
      folderName: folderPath.split("/").pop()!,
      filePath: `${folderPath}/project.md`,
      project: PROJECT,
    },
  ]);
}

function makeApp(entries: TAbstractFile[]) {
  const byPath = new Map<string, TAbstractFile>();
  const index = (entry: TAbstractFile): void => {
    byPath.set(entry.path, entry);
    if (entry instanceof TFolder) entry.children.forEach(index);
  };
  entries.forEach(index);
  const openFile = jest.fn().mockResolvedValue(undefined);
  const events = { on: () => ({}) as EventRef, offref: () => {} };
  const app = {
    vault: {
      ...events,
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
      getFiles: () => [...byPath.values()].filter((entry) => entry instanceof TFile),
    },
    metadataCache: events,
    workspace: { iterateAllLeaves: () => {}, getLeaf: () => ({ openFile }) },
  } as unknown as App;
  return { app, openFile, add: index };
}

function projectFolderFixture(folderPath = PROJECT_FOLDER) {
  return makeFolder(folderPath, [
    makeFile(`${folderPath}/project.md`),
    makeFolder(`${folderPath}/outputs`, [makeFile(`${folderPath}/outputs/timeline.md`)]),
    makeFile(`${folderPath}/brief.md`),
  ]);
}

function renderPopover(app: App, messages: AgentChatMessage[]) {
  const view = render(
    <AppContext.Provider value={app}>
      <ProjectInfoPopover app={app} project={PROJECT} messages={messages} />
    </AppContext.Provider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Project info for Q4 Launch" }));
  return view;
}

function changedRows(): string[] {
  return within(screen.getByRole("region", { name: "Changed in this chat" }))
    .queryAllByRole("button")
    .map((row) => row.textContent ?? "");
}

function sectionTitles(): string[] {
  return screen
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-labelledby") ?? "")
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

beforeAll(installRadixMenuPolyfills);

beforeEach(() => setProjectFolder(PROJECT_FOLDER));

afterEach(() => updateCachedProjectRecords([]));

describe("ProjectInfoPopover", () => {
  describe("ProjectInfoPanel()", () => {
    it("lists each changed file by name with its folder, new, edited or deleted, and lines added and removed", () => {
      render(
        <ProjectInfoPanel
          changes={[
            change(`${PROJECT_FOLDER}/outputs/timeline.md`, null, "week 1\nweek 2\n"),
            change(`${PROJECT_FOLDER}/brief.md`, "one\ntwo\n", "one\nTWO\nthree\n"),
            change(`${PROJECT_FOLDER}/draft.md`, "old\n", null),
          ]}
          onOpenFile={() => {}}
        >
          {null}
        </ProjectInfoPanel>
      );

      expect(changedRows()).toEqual([
        `timeline.md${PROJECT_FOLDER}/outputs/new+2−0`,
        `brief.md${PROJECT_FOLDER}/edited+2−1`,
        `draft.md${PROJECT_FOLDER}/deleted+0−1`,
      ]);
    });

    it("says nothing has changed yet when the chat has changed no file — https://github.com/Brevilabs/obsidian-copilot-private/issues/839", () => {
      render(
        <ProjectInfoPanel changes={[]} onOpenFile={() => {}}>
          {null}
        </ProjectInfoPanel>
      );

      expect(changedRows()).toEqual([]);
      expect(screen.getByText("No files changed in this chat yet.")).toBeTruthy();
    });

    it("opens a clicked file by its vault path, in a new tab when the click asks for one", () => {
      const onOpenFile = jest.fn();
      render(
        <ProjectInfoPanel
          changes={[change(`${PROJECT_FOLDER}/brief.md`, "a\n", "b\n")]}
          onOpenFile={onOpenFile}
        >
          {null}
        </ProjectInfoPanel>
      );

      fireEvent.click(screen.getByRole("button", { name: /brief\.md/ }));
      fireEvent.click(screen.getByRole("button", { name: /brief\.md/ }), { metaKey: true });

      expect(onOpenFile.mock.calls).toEqual([
        [`${PROJECT_FOLDER}/brief.md`, false],
        [`${PROJECT_FOLDER}/brief.md`, "tab"],
      ]);
    });
  });

  describe("ProjectInfoPopover()", () => {
    it("opens with the files this chat changed, latest first, then the project's Project folder and Linked, with no Progress or Outputs", () => {
      const { app } = makeApp([projectFolderFixture()]);

      renderPopover(app, [
        turn("first", [change(`${PROJECT_FOLDER}/outputs/timeline.md`, null, "week 1\n")]),
        turn("second", [change(`${PROJECT_FOLDER}/brief.md`, "a\n", "b\n")]),
      ]);

      expect(sectionTitles()).toEqual(["Changed in this chat", "Project folder", "Linked"]);
      expect(changedRows().map((row) => row.split(PROJECT_FOLDER)[0])).toEqual([
        "brief.md",
        "timeline.md",
      ]);
      expect(screen.queryByText("Progress")).toBeNull();
      expect(screen.queryByText("Outputs")).toBeNull();
    });

    it("shows the empty Changed in this chat above the Files view in a chat that has changed nothing", () => {
      const { app } = makeApp([projectFolderFixture()]);

      renderPopover(app, [turn("reply")]);

      expect(screen.getByText("No files changed in this chat yet.")).toBeTruthy();
      expect(sectionTitles()).toEqual(["Changed in this chat", "Project folder", "Linked"]);
    });

    it("offers no Link context, since linking happens only on the project home's Files tab — https://github.com/Brevilabs/obsidian-copilot-private/issues/839", () => {
      const { app } = makeApp([projectFolderFixture()]);
      renderPopover(app, [turn("reply")]);

      expect(screen.getByRole("region", { name: "Linked" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Link context" })).toBeNull();
    });

    it("takes no drops on its Files view, so dragging a computer file over it neither highlights nor is claimed from the chat — https://github.com/Brevilabs/obsidian-copilot-private/issues/839", () => {
      const { app } = makeApp([projectFolderFixture()]);
      renderPopover(app, [turn("reply")]);
      const filesView = screen.getByRole("region", { name: "Linked" }).parentElement!;

      const dragOver = fireEvent.dragOver(filesView, { dataTransfer: { types: ["Files"] } });

      expect(dragOver).toBe(true);
      expect(document.querySelector("[data-copilot-drop-zone]")).toBeNull();
      expect(screen.queryByText("Link files to this project")).toBeNull();
    });

    it("opens a changed file in a tab and closes the popover", () => {
      const { app, openFile } = makeApp([projectFolderFixture()]);
      renderPopover(app, [turn("first", [change(`${PROJECT_FOLDER}/brief.md`, "a\n", "b\n")])]);

      fireEvent.click(
        within(screen.getByRole("region", { name: "Changed in this chat" })).getByRole("button", {
          name: /brief\.md/,
        })
      );

      expect(openFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${PROJECT_FOLDER}/brief.md` })
      );
      expect(screen.queryByRole("region", { name: "Changed in this chat" })).toBeNull();
    });

    it("shows the new folder path and its files when the project folder is renamed while the popover is open", () => {
      const renamed = "copilot/projects/Q4 Renamed";
      const { app, add } = makeApp([projectFolderFixture()]);
      renderPopover(app, []);

      add(projectFolderFixture(renamed));
      act(() => setProjectFolder(renamed));

      const tree = screen.getByRole("region", { name: "Project folder" });
      expect(within(tree).getByText(renamed)).toBeTruthy();
      expect(
        within(tree)
          .getAllByRole("button")
          .map((row) => row.textContent)
      ).toEqual(["outputs", "brief.md"]);
    });
  });
});
