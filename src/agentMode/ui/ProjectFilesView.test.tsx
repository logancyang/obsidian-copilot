jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  return {
    ...actual,
    Menu: jest.fn().mockImplementation(function (this: FakeMenu) {
      this.items = [];
      this.addItem = (build) => {
        const item: FakeMenuItem = {
          title: "",
          click: () => {},
          setTitle: (title) => ((item.title = title), item),
          setIcon: () => item,
          onClick: (click) => ((item.click = click), item),
        };
        build(item);
        this.items.push(item);
        return this;
      };
      this.addSeparator = () => {
        this.items.push({ title: "---" } as FakeMenuItem);
        return this;
      };
      this.showAtMouseEvent = jest.fn();
    }),
  };
});

import {
  buildProjectTree,
  ProjectFilesView,
  ProjectFolderSection,
} from "@/agentMode/ui/ProjectFilesView";
import type { ProjectConfig } from "@/aiParams";
import { AppContext } from "@/context";
import { updateCachedProjectRecords } from "@/projects/state";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App, EventRef, Menu, TAbstractFile, TFile, TFolder } from "obsidian";
import React from "react";

interface FakeMenuItem {
  title: string;
  click: () => void;
  setTitle: (title: string) => FakeMenuItem;
  setIcon: (icon: string) => FakeMenuItem;
  onClick: (click: () => void) => FakeMenuItem;
}

interface FakeMenu {
  items: FakeMenuItem[];
  addItem: (build: (item: FakeMenuItem) => void) => FakeMenu;
  addSeparator: () => FakeMenu;
  showAtMouseEvent: jest.Mock;
}

const PROJECT_FOLDER = "copilot/projects/q4-launch";
const CONFIG_PATH = `${PROJECT_FOLDER}/project.md`;

type VaultListener = (file: TAbstractFile, oldPath?: string) => void;

function makeFolder(path: string, children: TAbstractFile[] = []): TFolder {
  const folder = new (TFolder as unknown as new (path: string) => TFolder)(path);
  setChildren(folder, children);
  return folder;
}

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function setChildren(folder: TFolder, children: TAbstractFile[]): void {
  (folder as unknown as { children: TAbstractFile[] }).children = children;
}

function rename(file: TAbstractFile, path: string): void {
  (file as unknown as { path: string; name: string }).path = path;
  (file as unknown as { name: string }).name = path.split("/").pop() ?? "";
}

function makeProject(): ProjectConfig {
  return {
    id: "q4",
    name: "Q4 Launch",
    systemPrompt: "",
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
  };
}

interface FakeVault {
  app: App;
  emit: (event: "create" | "delete" | "rename", file: TAbstractFile, oldPath?: string) => void;
  listenerCount: () => number;
  openFile: jest.Mock;
  trigger: jest.Mock;
  onDragStart: jest.Mock;
  promptForFileRename: jest.Mock;
  promptForDeletion: jest.Mock;
}

function makeFakeVault(root: TFolder | null): FakeVault {
  const listeners = new Map<EventRef, { event: string; listener: VaultListener }>();
  const filesByPath = new Map<string, TAbstractFile>();
  const index = (entry: TAbstractFile): void => {
    filesByPath.set(entry.path, entry);
    if (entry instanceof TFolder) entry.children.forEach(index);
  };
  const openFile = jest.fn().mockResolvedValue(undefined);
  const trigger = jest.fn();
  const onDragStart = jest.fn();
  const promptForFileRename = jest.fn().mockResolvedValue(undefined);
  const promptForDeletion = jest.fn().mockResolvedValue(true);
  const app = {
    fileManager: { promptForFileRename, promptForDeletion },
    vault: {
      getAbstractFileByPath: (path: string) => {
        filesByPath.clear();
        if (root) index(root);
        return filesByPath.get(path) ?? null;
      },
      on: (event: string, listener: VaultListener) => {
        const ref = {} as EventRef;
        listeners.set(ref, { event, listener });
        return ref;
      },
      offref: (ref: EventRef) => listeners.delete(ref),
    },
    workspace: {
      iterateAllLeaves: () => {},
      getLeaf: () => ({ openFile }),
      trigger,
    },
    metadataCache: { fileToLinktext: (file: TFile) => file.path.replace(/\.md$/, "") },
    dragManager: {
      dragLink: (_event: DragEvent, linkText: string) => ({ type: "link", linktext: linkText }),
      onDragStart,
    },
  } as unknown as App;
  return {
    app,
    emit: (event, file, oldPath) => {
      act(() => {
        for (const entry of listeners.values()) {
          if (entry.event === event) entry.listener(file, oldPath);
        }
      });
    },
    listenerCount: () => listeners.size,
    openFile,
    trigger,
    onDragStart,
    promptForFileRename,
    promptForDeletion,
  };
}

function renderView(vault: FakeVault) {
  return render(
    <AppContext.Provider value={vault.app}>
      <ProjectFilesView projectId="q4" />
    </AppContext.Provider>
  );
}

function rowNames(): string[] {
  return screen.getAllByRole("button").map((row) => row.textContent ?? "");
}

beforeAll(() => {
  window.activeDocument = window.document;
});

beforeEach(() => {
  updateCachedProjectRecords([
    { folderName: "q4-launch", filePath: CONFIG_PATH, project: makeProject() },
  ]);
});

afterEach(() => {
  updateCachedProjectRecords([]);
});

describe("ProjectFilesView", () => {
  describe("buildProjectTree()", () => {
    it("lists folders before files, each group in name order", () => {
      const folder = makeFolder(PROJECT_FOLDER, [
        makeFile(`${PROJECT_FOLDER}/brief.md`),
        makeFolder(`${PROJECT_FOLDER}/sources`),
        makeFile(`${PROJECT_FOLDER}/AGENTS.md`),
        makeFolder(`${PROJECT_FOLDER}/outputs`),
      ]);

      const nodes = buildProjectTree(folder, new Set(), CONFIG_PATH);

      expect(nodes.map((node) => `${node.kind}:${node.name}`)).toEqual([
        "folder:outputs",
        "folder:sources",
        "file:AGENTS.md",
        "file:brief.md",
      ]);
    });

    it("shows AGENTS.md but hides the project's config note and dotfiles", () => {
      const folder = makeFolder(PROJECT_FOLDER, [
        makeFile(CONFIG_PATH),
        makeFile(`${PROJECT_FOLDER}/AGENTS.md`),
        makeFile(`${PROJECT_FOLDER}/.DS_Store`),
        makeFolder(`${PROJECT_FOLDER}/.cache`),
      ]);

      const nodes = buildProjectTree(folder, new Set(), CONFIG_PATH);

      expect(nodes.map((node) => node.name)).toEqual(["AGENTS.md"]);
    });

    it("keeps a project.md inside a subfolder, since only the config note at the project root is hidden", () => {
      const outputs = makeFolder(`${PROJECT_FOLDER}/outputs`, [
        makeFile(`${PROJECT_FOLDER}/outputs/project.md`),
        makeFile(`${PROJECT_FOLDER}/outputs/.draft.md`),
      ]);
      const folder = makeFolder(PROJECT_FOLDER, [outputs]);

      const [outputsNode] = buildProjectTree(folder, new Set([outputs.path]), CONFIG_PATH);

      expect(outputsNode.kind === "folder" && outputsNode.children?.map((n) => n.name)).toEqual([
        "project.md",
      ]);
    });

    it("lists an expanded folder's children and leaves collapsed folders unread so large outputs/ folders stay cheap — https://github.com/Brevilabs/obsidian-copilot-private/issues/462", () => {
      const charts = makeFolder(`${PROJECT_FOLDER}/outputs/charts`, [
        makeFile(`${PROJECT_FOLDER}/outputs/charts/funnel.png`),
      ]);
      const outputs = makeFolder(`${PROJECT_FOLDER}/outputs`, [
        charts,
        makeFile(`${PROJECT_FOLDER}/outputs/timeline.md`),
      ]);
      const sources = makeFolder(`${PROJECT_FOLDER}/sources`, [
        makeFile(`${PROJECT_FOLDER}/sources/deck.pdf`),
      ]);
      const folder = makeFolder(PROJECT_FOLDER, [outputs, sources]);

      const nodes = buildProjectTree(folder, new Set([outputs.path]), CONFIG_PATH);

      expect(nodes).toEqual([
        {
          kind: "folder",
          path: outputs.path,
          name: "outputs",
          children: [
            { kind: "folder", path: charts.path, name: "charts", children: null },
            { kind: "file", path: `${PROJECT_FOLDER}/outputs/timeline.md`, name: "timeline.md" },
          ],
        },
        { kind: "folder", path: sources.path, name: "sources", children: null },
      ]);
    });

    it("returns the same empty list for every empty folder", () => {
      const first = buildProjectTree(makeFolder(PROJECT_FOLDER), new Set(), CONFIG_PATH);
      const second = buildProjectTree(makeFolder("elsewhere"), new Set(), CONFIG_PATH);

      expect(first).toEqual([]);
      expect(first).toBe(second);
    });
  });

  describe("ProjectFolderSection()", () => {
    const handlers = {
      onToggleFolder: jest.fn(),
      onOpenFile: jest.fn(),
      onShowFileMenu: jest.fn(),
      onDragFile: jest.fn(),
    };

    it("titles the section Project folder and shows the folder's vault path", () => {
      render(<ProjectFolderSection folderPath={PROJECT_FOLDER} nodes={[]} {...handlers} />);

      const section = screen.getByRole("region", { name: "Project folder" });
      expect(within(section).getByText(PROJECT_FOLDER)).toBeTruthy();
    });

    it("says the folder has no files yet when there is nothing to list", () => {
      render(<ProjectFolderSection folderPath={PROJECT_FOLDER} nodes={[]} {...handlers} />);

      expect(screen.getByText("No files yet.")).toBeTruthy();
    });

    it("nests an expanded folder's rows in a group below it and marks only that folder expanded", () => {
      render(
        <ProjectFolderSection
          folderPath={PROJECT_FOLDER}
          nodes={[
            {
              kind: "folder",
              path: "p/outputs",
              name: "outputs",
              children: [
                { kind: "folder", path: "p/outputs/charts", name: "charts", children: null },
              ],
            },
          ]}
          {...handlers}
        />
      );

      const outputsGroup = screen.getByRole("group", { name: "outputs" });
      const charts = within(outputsGroup).getByRole("button", { name: "charts" });
      expect(screen.getByRole("button", { name: "outputs" }).getAttribute("aria-expanded")).toBe(
        "true"
      );
      expect(charts.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("ProjectFilesView()", () => {
    function makeProjectFolder() {
      const funnel = makeFile(`${PROJECT_FOLDER}/outputs/charts/funnel.png`);
      const charts = makeFolder(`${PROJECT_FOLDER}/outputs/charts`, [funnel]);
      const timeline = makeFile(`${PROJECT_FOLDER}/outputs/timeline.md`);
      const outputs = makeFolder(`${PROJECT_FOLDER}/outputs`, [charts, timeline]);
      const agents = makeFile(`${PROJECT_FOLDER}/AGENTS.md`);
      const root = makeFolder(PROJECT_FOLDER, [makeFile(CONFIG_PATH), agents, outputs]);
      return { root, outputs, charts, funnel, timeline, agents };
    }

    it("lists the project folder's top level with folders first and the config note hidden", () => {
      const { root } = makeProjectFolder();

      renderView(makeFakeVault(root));

      expect(screen.getByText(PROJECT_FOLDER)).toBeTruthy();
      expect(rowNames()).toEqual(["outputs", "AGENTS.md"]);
    });

    it("renders nothing for a project that is not in the project cache", () => {
      updateCachedProjectRecords([]);

      const { container } = renderView(makeFakeVault(null));

      expect(container.innerHTML).toBe("");
    });

    it("says the folder has no files yet when the project folder does not exist", () => {
      renderView(makeFakeVault(null));

      expect(screen.getByText("No files yet.")).toBeTruthy();
    });

    it("expands a folder on click to show its children and collapses it on a second click", () => {
      const { root } = makeProjectFolder();
      renderView(makeFakeVault(root));

      fireEvent.click(screen.getByRole("button", { name: "outputs" }));
      expect(rowNames()).toEqual(["outputs", "charts", "timeline.md", "AGENTS.md"]);

      fireEvent.click(screen.getByRole("button", { name: "charts" }));
      expect(rowNames()).toEqual(["outputs", "charts", "funnel.png", "timeline.md", "AGENTS.md"]);

      fireEvent.click(screen.getByRole("button", { name: "outputs" }));
      expect(rowNames()).toEqual(["outputs", "AGENTS.md"]);
    });

    it("opens a clicked nested file in a tab", () => {
      const { root, timeline } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "outputs" }));
      fireEvent.click(screen.getByRole("button", { name: "timeline.md" }));

      expect(vault.openFile).toHaveBeenCalledWith(timeline);
    });

    it("opens a file when Enter is pressed on its row", () => {
      const { root, agents } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.keyDown(screen.getByRole("button", { name: "AGENTS.md" }), { key: "Enter" });

      expect(vault.openFile).toHaveBeenCalledWith(agents);
    });

    it("shows Obsidian's own file menu for a right-clicked row", () => {
      const { root, timeline } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "outputs" }));
      fireEvent.contextMenu(screen.getByRole("button", { name: "timeline.md" }));

      const menu = (Menu as unknown as jest.Mock).mock.instances.at(-1) as FakeMenu;
      expect(vault.trigger).toHaveBeenCalledWith(
        "file-menu",
        menu,
        timeline,
        "copilot-project-files"
      );
      expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
    });

    it("adds Rename and Delete in their own group at the end of a file's menu, since the file explorer adds those itself rather than through file-menu — https://github.com/Brevilabs/obsidian-copilot-private/issues/462", () => {
      const { root, agents } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.contextMenu(screen.getByRole("button", { name: "AGENTS.md" }));
      const menu = (Menu as unknown as jest.Mock).mock.instances.at(-1) as FakeMenu;
      expect(menu.items.map((item) => item.title)).toEqual(["---", "Rename...", "Delete"]);

      menu.items[1].click();
      expect(vault.promptForFileRename).toHaveBeenCalledWith(agents);
      menu.items[2].click();
      expect(vault.promptForDeletion).toHaveBeenCalledWith(agents);
    });

    it("offers Delete but not Rename for a folder, because Obsidian's rename prompt only renames files — https://github.com/Brevilabs/obsidian-copilot-private/issues/462", () => {
      const { root, outputs } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.contextMenu(screen.getByRole("button", { name: "outputs" }));
      const menu = (Menu as unknown as jest.Mock).mock.instances.at(-1) as FakeMenu;
      expect(menu.items.map((item) => item.title)).toEqual(["---", "Delete"]);

      menu.items[1].click();
      expect(vault.promptForDeletion).toHaveBeenCalledWith(outputs);
    });

    it("starts Obsidian's link drag for a dragged file so the composer @-mentions it", () => {
      const { root } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "outputs" }));
      fireEvent.dragStart(screen.getByRole("button", { name: "timeline.md" }), {
        dataTransfer: { setData: jest.fn() },
      });

      expect(vault.onDragStart).toHaveBeenCalledWith(expect.anything(), {
        type: "link",
        linktext: `${PROJECT_FOLDER}/outputs/timeline`,
      });
    });

    it("shows a file created in an expanded folder without a restart", () => {
      const { root, outputs } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);
      fireEvent.click(screen.getByRole("button", { name: "outputs" }));

      const created = makeFile(`${PROJECT_FOLDER}/outputs/press-release.md`);
      setChildren(outputs, [...outputs.children, created]);
      vault.emit("create", created);

      expect(rowNames()).toEqual([
        "outputs",
        "charts",
        "press-release.md",
        "timeline.md",
        "AGENTS.md",
      ]);
    });

    it("shows a renamed file under its new name", () => {
      const { root, timeline } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);
      fireEvent.click(screen.getByRole("button", { name: "outputs" }));

      const oldPath = timeline.path;
      rename(timeline, `${PROJECT_FOLDER}/outputs/launch-timeline.md`);
      vault.emit("rename", timeline, oldPath);

      expect(rowNames()).toEqual(["outputs", "charts", "launch-timeline.md", "AGENTS.md"]);
    });

    it("drops a deleted file from the tree", () => {
      const { root, agents, outputs } = makeProjectFolder();
      const vault = makeFakeVault(root);
      renderView(vault);

      setChildren(root, [outputs]);
      vault.emit("delete", agents);

      expect(rowNames()).toEqual(["outputs"]);
    });

    it("stops listening to the vault once unmounted", () => {
      const { root } = makeProjectFolder();
      const vault = makeFakeVault(root);
      const { unmount } = renderView(vault);
      expect(vault.listenerCount()).toBe(3);

      unmount();

      expect(vault.listenerCount()).toBe(0);
    });
  });
});
