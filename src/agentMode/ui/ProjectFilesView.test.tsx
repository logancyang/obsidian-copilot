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

const mockUpdateProject = jest.fn();
const mockOpenSearch = jest.fn();

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ updateProject: mockUpdateProject }) },
}));

jest.mock("@/components/modals/VaultItemSearchModal", () => ({
  VaultItemSearchModal: jest.fn().mockImplementation((_app, onChoose) => ({
    open: () => mockOpenSearch(onChoose),
  })),
}));

import {
  buildLinkedRows,
  buildProjectTree,
  LinkedSection,
  type LinkedProjectRow,
  ProjectFilesView,
  ProjectFolderSection,
} from "@/agentMode/ui/ProjectFilesView";
import type { ProjectConfig } from "@/aiParams";
import { AppContext } from "@/context";
import {
  getCachedProjectRecordById,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App, EventRef, Menu, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
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

function makeProject(contextSource: ProjectConfig["contextSource"] = {}): ProjectConfig {
  return {
    id: "q4",
    name: "Q4 Launch",
    systemPrompt: "",
    contextSource,
    created: 0,
    UsageTimestamps: 0,
  };
}

function inclusionsOf(patterns: string[]): string {
  return patterns.map(encodeURIComponent).join(",");
}

function linkPatterns(patterns: string[]): void {
  updateCachedProjectRecords([
    {
      folderName: "q4-launch",
      filePath: CONFIG_PATH,
      project: makeProject({ inclusions: inclusionsOf(patterns) }),
    },
  ]);
}

function savedPatterns(): string[] {
  return (getCachedProjectRecordById("q4")?.project.contextSource.inclusions ?? "")
    .split(",")
    .filter(Boolean)
    .map((pattern) => decodeURIComponent(pattern));
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
  createBinary: jest.Mock;
  setDraggable: (draggable: unknown) => void;
}

function makeFakeVault(root: TFolder | null, outside: TFolder[] = []): FakeVault {
  const listeners = new Map<EventRef, { event: string; listener: VaultListener }>();
  const filesByPath = new Map<string, TAbstractFile>();
  const index = (entry: TAbstractFile): void => {
    filesByPath.set(entry.path, entry);
    if (entry instanceof TFolder) entry.children.forEach(index);
  };
  const reindex = (): void => {
    filesByPath.clear();
    if (root) index(root);
    outside.forEach(index);
  };
  const createBinary = jest.fn(async (path: string) => {
    const created = makeFile(path);
    filesByPath.set(path, created);
    return created;
  });
  const dragManager: Record<string, unknown> = { draggable: null };
  const openFile = jest.fn().mockResolvedValue(undefined);
  const trigger = jest.fn();
  const onDragStart = jest.fn();
  const promptForFileRename = jest.fn().mockResolvedValue(undefined);
  const promptForDeletion = jest.fn().mockResolvedValue(true);
  const app = {
    fileManager: { promptForFileRename, promptForDeletion },
    vault: {
      getAbstractFileByPath: (path: string) => {
        reindex();
        return filesByPath.get(path) ?? null;
      },
      getFiles: () => {
        reindex();
        return [...filesByPath.values()].filter((entry) => entry instanceof TFile);
      },
      adapter: {
        exists: async (path: string) => createBinary.mock.calls.some(([p]) => p === path),
        mkdir: jest.fn(async () => {}),
      },
      createBinary,
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
    dragManager: Object.assign(dragManager, {
      dragLink: (_event: DragEvent, linkText: string) => ({ type: "link", linktext: linkText }),
      onDragStart,
    }),
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
    createBinary,
    setDraggable: (draggable) => (dragManager.draggable = draggable),
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
  return within(screen.getByRole("region", { name: "Project folder" }))
    .getAllByRole("button")
    .map((row) => row.textContent ?? "");
}

beforeAll(() => {
  window.activeDocument = window.document;
});

beforeEach(() => {
  mockUpdateProject.mockReset().mockImplementation(async (_id: string, next: ProjectConfig) => {
    const record = getCachedProjectRecordById(next.id)!;
    act(() => upsertCachedProjectRecord({ ...record, project: next }));
    return record;
  });
  mockOpenSearch.mockReset();
  (Notice as unknown as jest.Mock).mockClear();
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

  describe("buildLinkedRows()", () => {
    function linkedVault() {
      const tiers = makeFile("Research/Pricing/tiers.md");
      const enterprise = makeFolder("Research/Pricing/enterprise");
      const pricing = makeFolder("Research/Pricing", [tiers, enterprise]);
      const work = makeFolder("Work", [makeFolder("Work/Notes")]);
      const personal = makeFolder("Personal", [makeFolder("Personal/Notes")]);
      const meetings = makeFolder("Meetings", [makeFile("Meetings/Q3 retro.md")]);
      return makeFakeVault(null, [makeFolder("Research", [pricing]), work, personal, meetings]).app;
    }

    function describeRows(rows: readonly LinkedProjectRow[]): string[] {
      return rows.map((row) => `${row.node.kind} ${row.node.name} in ${row.parent || "/"}`);
    }

    it("lists linked folders, then linked notes, each by name with the folder it sits in", () => {
      const rows = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["[[Q3 retro]]", "Research/Pricing"]),
        new Set(),
        CONFIG_PATH
      );

      expect(describeRows(rows)).toEqual([
        "folder Pricing in Research/",
        "file Q3 retro.md in Meetings/",
      ]);
      expect(rows.map((row) => row.pattern)).toEqual(["Research/Pricing", "[[Q3 retro]]"]);
    });

    it("keeps two same-named folders under different parents as two rows with their own paths — https://github.com/logancyang/obsidian-copilot/issues/3089", () => {
      const rows = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["Work/Notes", "Personal/Notes"]),
        new Set(),
        CONFIG_PATH
      );

      expect(rows.map((row) => row.node.path)).toEqual(["Work/Notes", "Personal/Notes"]);
      expect(describeRows(rows)).toEqual(["folder Notes in Work/", "folder Notes in Personal/"]);
    });

    it("reads an expanded linked folder's current contents with the Project folder tree's rules", () => {
      const [collapsed] = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["Research/Pricing"]),
        new Set(),
        CONFIG_PATH
      );
      const [expanded] = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["Research/Pricing"]),
        new Set(["Research/Pricing"]),
        CONFIG_PATH
      );

      expect(collapsed.node).toMatchObject({ kind: "folder", children: null });
      expect(
        expanded.node.kind === "folder" && expanded.node.children?.map((child) => child.name)
      ).toEqual(["enterprise", "tiers.md"]);
    });

    it("keeps a link whose note or folder no longer exists as a missing row, so it can still be unlinked", () => {
      const rows = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["[[Old plan]]", "Archive/2025"]),
        new Set(),
        CONFIG_PATH
      );

      expect(rows.map((row) => [row.node.name, row.missing])).toEqual([
        ["2025", true],
        ["Old plan", true],
      ]);
    });

    it("returns the same empty list when nothing linkable is saved, such as only tags", () => {
      const first = buildLinkedRows(linkedVault(), undefined, new Set(), CONFIG_PATH);
      const second = buildLinkedRows(
        linkedVault(),
        inclusionsOf(["#launch"]),
        new Set(),
        CONFIG_PATH
      );

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

  describe("LinkedSection()", () => {
    const handlers = {
      onToggleFolder: jest.fn(),
      onOpenFile: jest.fn(),
      onShowFileMenu: jest.fn(),
      onDragFile: jest.fn(),
      onAdd: jest.fn(),
      onUnlink: jest.fn(),
    };
    const ROWS: LinkedProjectRow[] = [
      {
        pattern: "Research/Pricing",
        node: { kind: "folder", path: "Research/Pricing", name: "Pricing", children: null },
        parent: "Research/",
        missing: false,
      },
      {
        pattern: "[[Q3 retro]]",
        node: { kind: "file", path: "Meetings/Q3 retro.md", name: "Q3 retro.md" },
        parent: "Meetings/",
        missing: false,
      },
    ];

    function linkedRegion(): HTMLElement {
      return screen.getByRole("region", { name: "Linked" });
    }

    it("titles the section Linked and shows each item with the folder it sits in", () => {
      render(<LinkedSection rows={ROWS} isDragOver={false} {...handlers} />);

      const pricing = within(linkedRegion()).getByRole("button", { name: /^Pricing/ });
      expect(pricing.textContent).toBe("PricingResearch/");
      expect(within(linkedRegion()).getByRole("button", { name: /^Q3 retro/ }).textContent).toBe(
        "Q3 retro.mdMeetings/"
      );
    });

    it("says a missing item is not found", () => {
      render(
        <LinkedSection
          rows={[{ ...ROWS[1], node: { ...ROWS[1].node, path: "[[Q3 retro]]" }, missing: true }]}
          isDragOver={false}
          {...handlers}
        />
      );

      expect(within(linkedRegion()).getByText("Not found")).toBeTruthy();
    });

    it("asks for a drop and says files from the computer go to sources/", () => {
      render(<LinkedSection rows={[]} isDragOver={false} {...handlers} />);

      expect(
        within(linkedRegion()).getByText(
          "Drop notes or folders here to link them. Files from your computer are copied to sources/."
        )
      ).toBeTruthy();
    });

    it("says a drop links the item while something is dragged over the Files tab", () => {
      render(<LinkedSection rows={ROWS} isDragOver {...handlers} />);

      expect(within(linkedRegion()).getByText("Drop to link it to this project.")).toBeTruthy();
    });

    it("searches for a note or folder from +, so linking works without dragging", () => {
      render(<LinkedSection rows={[]} isDragOver={false} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: "Link a note or folder" }));

      expect(handlers.onAdd).toHaveBeenCalled();
    });

    it("unlinks an item by its saved link from its Unlink button without opening it", () => {
      render(<LinkedSection rows={ROWS} isDragOver={false} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: "Unlink Q3 retro.md" }));

      expect(handlers.onUnlink).toHaveBeenCalledWith("[[Q3 retro]]");
      expect(handlers.onOpenFile).not.toHaveBeenCalled();
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

    function linkedFixture() {
      const { root, timeline } = makeProjectFolder();
      const tiers = makeFile("Research/Pricing/tiers.md");
      const pricing = makeFolder("Research/Pricing", [tiers]);
      const research = makeFolder("Research", [pricing]);
      const workNotes = makeFolder("Work/Notes");
      const personalNotes = makeFolder("Personal/Notes");
      const work = makeFolder("Work", [workNotes]);
      const personal = makeFolder("Personal", [personalNotes]);
      const retro = makeFile("Meetings/Q3 retro.md");
      const meetings = makeFolder("Meetings", [retro]);
      const vault = makeFakeVault(root, [research, work, personal, meetings]);
      return { vault, timeline, pricing, workNotes, personalNotes, retro };
    }

    function linkedNames(): string[] {
      return within(screen.getByRole("region", { name: "Linked" }))
        .getAllByRole("button")
        .filter((button) => button.getAttribute("role") === "button")
        .map((row) => row.querySelector("span[title]")?.textContent ?? "");
    }

    function dropZone(): HTMLElement {
      return screen.getByRole("region", { name: "Linked" }).closest("[data-copilot-drop-zone]")!;
    }

    function noticeMessages(): string[] {
      return (Notice as unknown as jest.Mock).mock.calls.map(([message]) => message);
    }

    it("lists linked notes and folders below the Project folder and expands a linked folder to its current contents", () => {
      linkPatterns(["[[Q3 retro]]", "Research/Pricing"]);
      const { vault } = linkedFixture();
      renderView(vault);

      const tree = screen.getByRole("region", { name: "Project folder" });
      const linked = screen.getByRole("region", { name: "Linked" });
      expect(tree.compareDocumentPosition(linked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(linkedNames()).toEqual(["Pricing", "Q3 retro.md"]);

      fireEvent.click(within(linked).getByRole("button", { name: /^Pricing/ }));

      expect(linkedNames()).toEqual(["Pricing", "tiers.md", "Q3 retro.md"]);
    });

    it("unlinks an item and leaves the original in the vault", async () => {
      linkPatterns(["[[Q3 retro]]", "Research/Pricing"]);
      const { vault } = linkedFixture();
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "Unlink Pricing" }));

      await waitFor(() => expect(linkedNames()).toEqual(["Q3 retro.md"]));
      expect(savedPatterns()).toEqual(["[[Q3 retro]]"]);
      expect(vault.promptForDeletion).not.toHaveBeenCalled();
      expect(vault.app.vault.getAbstractFileByPath("Research/Pricing")).toBeTruthy();
    });

    it("links the nested folder chosen from + by its full vault path", async () => {
      const { vault, workNotes } = linkedFixture();
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "Link a note or folder" }));
      act(() => {
        mockOpenSearch.mock.calls[0][0](workNotes);
      });

      await waitFor(() => expect(linkedNames()).toEqual(["Notes"]));
      expect(savedPatterns()).toEqual(["Work/Notes"]);
      expect(noticeMessages()).toContain("Linked Notes to the project");
    });

    it("links exactly the nested folder dragged from the file explorer, so same-named folders under different parents stay apart — https://github.com/logancyang/obsidian-copilot/issues/3089", async () => {
      const { vault, workNotes, personalNotes } = linkedFixture();
      renderView(vault);

      vault.setDraggable({ type: "folder", file: workNotes });
      fireEvent.drop(dropZone(), { dataTransfer: { types: ["text/plain"], files: [] } });
      await waitFor(() => expect(savedPatterns()).toEqual(["Work/Notes"]));
      vault.setDraggable({ type: "folder", file: personalNotes });
      fireEvent.drop(dropZone(), { dataTransfer: { types: ["text/plain"], files: [] } });

      await waitFor(() => expect(savedPatterns()).toEqual(["Work/Notes", "Personal/Notes"]));
      expect(
        within(screen.getByRole("region", { name: "Linked" })).getAllByText(/^(Work|Personal)\/$/)
      ).toHaveLength(2);
    });

    it("links a note dropped from the file explorer by its existing [[name]] link", async () => {
      const { vault, retro } = linkedFixture();
      renderView(vault);

      vault.setDraggable({ type: "file", file: retro });
      fireEvent.drop(dropZone(), { dataTransfer: { types: ["text/plain"], files: [] } });

      await waitFor(() => expect(linkedNames()).toEqual(["Q3 retro.md"]));
      expect(savedPatterns()).toEqual(["[[Q3 retro]]"]);
    });

    it("is its own drop zone, so the composer's overlay and attachment skip it, and highlights while a vault item is dragged over", () => {
      const { vault, workNotes } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "folder", file: workNotes });

      const dragOver = fireEvent.dragOver(dropZone(), {
        dataTransfer: { types: ["text/plain"], dropEffect: "none" },
      });
      expect(dragOver).toBe(false);
      expect(screen.getByText("Drop to link it to this project.")).toBeTruthy();

      fireEvent.dragLeave(dropZone(), { relatedTarget: null });
      expect(screen.queryByText("Drop to link it to this project.")).toBeNull();
    });

    it("drops the highlight when a drag over it ends without a drop or dragleave, as when Escape cancels it — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", () => {
      const { vault, workNotes } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "folder", file: workNotes });
      fireEvent.dragOver(dropZone(), { dataTransfer: { types: ["text/plain"] } });
      expect(screen.getByText("Drop to link it to this project.")).toBeTruthy();

      fireEvent.dragEnd(document);

      expect(screen.queryByText("Drop to link it to this project.")).toBeNull();
      expect(dropZone().className).not.toContain("tw-ring-2");
    });

    it("ignores a drag of its own rows, so moving a row toward the message box neither highlights nor links", () => {
      const { vault, timeline } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "link", file: timeline });
      const dataTransfer = { types: ["copilot/internal-drag", "text/plain"], files: [] };

      const dragOver = fireEvent.dragOver(dropZone(), { dataTransfer });
      fireEvent.drop(dropZone(), { dataTransfer });

      expect(dragOver).toBe(true);
      expect(screen.queryByText("Drop to link it to this project.")).toBeNull();
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("copies a file dropped from the computer into sources/ and links nothing", async () => {
      const { vault } = linkedFixture();
      renderView(vault);
      const pdf = { name: "board-notes.pdf", arrayBuffer: async () => new ArrayBuffer(4) };

      fireEvent.drop(dropZone(), { dataTransfer: { types: ["Files"], files: [pdf] } });

      await waitFor(() =>
        expect(noticeMessages()).toContain("Copied board-notes.pdf into sources/")
      );
      expect(vault.createBinary).toHaveBeenCalledWith(
        `${PROJECT_FOLDER}/sources/board-notes.pdf`,
        expect.any(ArrayBuffer)
      );
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("says an item from the project folder is already in this project instead of linking it — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", async () => {
      const { vault, timeline } = linkedFixture();
      renderView(vault);

      vault.setDraggable({ type: "file", file: timeline });
      fireEvent.drop(dropZone(), { dataTransfer: { types: ["text/plain"], files: [] } });

      await waitFor(() => expect(noticeMessages()).toContain("Already in this project"));
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

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

    it("starts no drag for a file the composer cannot attach, such as a CSV, so it never shows an unsupported-file notice, for https://github.com/Brevilabs/obsidian-copilot-private/issues/462", () => {
      const root = makeFolder(PROJECT_FOLDER, [makeFile(`${PROJECT_FOLDER}/metrics.csv`)]);
      const vault = makeFakeVault(root);
      renderView(vault);

      const started = fireEvent.dragStart(screen.getByRole("button", { name: "metrics.csv" }), {
        dataTransfer: { setData: jest.fn() },
      });

      expect(started).toBe(false);
      expect(vault.onDragStart).not.toHaveBeenCalled();
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
