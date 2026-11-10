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
const mockOpenPicker = jest.fn();

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ updateProject: mockUpdateProject }) },
}));

jest.mock("@/projects/ui/ProjectFileSelectModal", () => ({
  ProjectFileSelectModal: jest.fn().mockImplementation(({ onFileSelect }) => ({
    open: () => mockOpenPicker("files", onFileSelect),
  })),
}));

jest.mock("@/components/modals/FolderSearchModal", () => ({
  FolderSearchModal: jest.fn().mockImplementation((_app, onChooseFolder) => ({
    open: () => mockOpenPicker("folders", onChooseFolder),
  })),
}));

jest.mock("@/components/modals/TagSearchModal", () => ({
  TagSearchModal: jest.fn().mockImplementation((_app, onChooseTag) => ({
    open: () => mockOpenPicker("tags", onChooseTag),
  })),
}));

jest.mock("@/components/modals/PropertySearchModal", () => ({
  PropertySearchModal: jest.fn().mockImplementation((_app, onChoose) => ({
    open: () => mockOpenPicker("properties", onChoose),
  })),
}));

jest.mock("@/projects/ui/LinkUrlModal", () => ({
  LinkUrlModal: jest.fn().mockImplementation((_app, onChoose) => ({
    open: () => mockOpenPicker("link", onChoose),
  })),
}));

import {
  buildLinkedRows,
  buildLinkedMatchRows,
  buildProjectTree,
  LinkedSection,
  type LinkedProjectRow,
  ProjectFilesPanel,
  type LinkedMatchRow,
  ProjectFilesView,
  ProjectFolderSection,
} from "@/projects/ui/ProjectFilesView";
import type { ProjectConfig } from "@/aiParams";
import { createUrlItem } from "@/lib/url-tag";
import { AppContext } from "@/context";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import {
  getCachedProjectRecordById,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  App,
  CachedMetadata,
  EventRef,
  Menu,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";
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

function linkPatterns(patterns: string[], urls: ProjectConfig["contextSource"] = {}): void {
  updateCachedProjectRecords([
    {
      folderName: "q4-launch",
      filePath: CONFIG_PATH,
      project: makeProject({ inclusions: inclusionsOf(patterns), ...urls }),
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
  setTags: (
    file: TFile,
    cache: { frontmatter?: Record<string, unknown>; inlineTags?: string[] }
  ) => void;
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
  const caches = new Map<string, CachedMetadata>();
  const on = (event: string, listener: VaultListener) => {
    const ref = {} as EventRef;
    listeners.set(ref, { event, listener });
    return ref;
  };
  const offref = (ref: EventRef) => listeners.delete(ref);
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
      getMarkdownFiles: () => {
        reindex();
        return [...filesByPath.values()].filter(
          (entry): entry is TFile => entry instanceof TFile && entry.extension === "md"
        );
      },
      adapter: {
        exists: async (path: string) => createBinary.mock.calls.some(([p]) => p === path),
        mkdir: jest.fn(async () => {}),
      },
      createBinary,
      on,
      offref,
    },
    workspace: {
      iterateAllLeaves: () => {},
      getLeaf: () => ({ openFile }),
      trigger,
    },
    metadataCache: {
      fileToLinktext: (file: TFile) => file.path.replace(/\.md$/, ""),
      getFileCache: (file: TFile) => caches.get(file.path) ?? null,
      on: (event: string, listener: VaultListener) => on(`metadata:${event}`, listener),
      offref,
    },
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
    setTags: (file, { frontmatter, inlineTags = [] }) => {
      caches.set(file.path, {
        frontmatter,
        tags: inlineTags.map((tag) => ({ tag })),
      } as unknown as CachedMetadata);
      act(() => {
        for (const entry of listeners.values()) {
          if (entry.event === "metadata:changed") entry.listener(file);
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

function chooseLinkKind(label: string): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Link context" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: label }));
}

beforeAll(installRadixMenuPolyfills);

beforeEach(() => {
  mockUpdateProject.mockReset().mockImplementation(async (_id: string, next: ProjectConfig) => {
    const record = getCachedProjectRecordById(next.id)!;
    act(() => upsertCachedProjectRecord({ ...record, project: next }));
    return record;
  });
  mockOpenPicker.mockReset();
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
        { folders: ["Research/Pricing"], notes: ["[[Q3 retro]]"] },
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
        { folders: ["Work/Notes", "Personal/Notes"], notes: [] },
        new Set(),
        CONFIG_PATH
      );

      expect(rows.map((row) => row.node.path)).toEqual(["Work/Notes", "Personal/Notes"]);
      expect(describeRows(rows)).toEqual(["folder Notes in Work/", "folder Notes in Personal/"]);
    });

    it("reads an expanded linked folder's current contents with the Project folder tree's rules", () => {
      const [collapsed] = buildLinkedRows(
        linkedVault(),
        { folders: ["Research/Pricing"], notes: [] },
        new Set(),
        CONFIG_PATH
      );
      const [expanded] = buildLinkedRows(
        linkedVault(),
        { folders: ["Research/Pricing"], notes: [] },
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
        { folders: ["Archive/2025"], notes: ["[[Old plan]]"] },
        new Set(),
        CONFIG_PATH
      );

      expect(rows.map((row) => [row.node.name, row.missing])).toEqual([
        ["2025", true],
        ["Old plan", true],
      ]);
    });

    it("returns the same empty list when nothing is linked", () => {
      const first = buildLinkedRows(
        linkedVault(),
        { folders: [], notes: [] },
        new Set(),
        CONFIG_PATH
      );
      const second = buildLinkedRows(
        linkedVault(),
        { folders: [], notes: [] },
        new Set(),
        CONFIG_PATH
      );

      expect(first).toEqual([]);
      expect(first).toBe(second);
    });
  });

  describe("buildLinkedMatchRows()", () => {
    function taggedVault() {
      const standup = makeFile("Work/standup.md");
      const brief = makeFile("Plans/brief.md");
      const budget = makeFile("Plans/budget.md");
      const vault = makeFakeVault(null, [
        makeFolder("Work", [standup]),
        makeFolder("Plans", [brief, budget]),
      ]);
      vault.setTags(standup, { inlineTags: ["#launch"], frontmatter: { status: "Active" } });
      vault.setTags(brief, {
        frontmatter: { tags: ["launch", "q4"], status: ["active", "draft"] },
      });
      vault.setTags(budget, { frontmatter: { tags: ["q4"], status: "done" } });
      return vault.app;
    }

    it("lists each linked tag with how many notes carry it in properties or inline, leaving its notes unread until it is expanded — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      const rows = buildLinkedMatchRows(
        taggedVault(),
        { tags: ["#launch", "#q4", "#archived"], properties: [] },
        new Set()
      );

      expect(rows).toEqual([
        { kind: "tag", pattern: "#launch", label: "#launch", count: 2, notes: null },
        { kind: "tag", pattern: "#q4", label: "#q4", count: 2, notes: null },
        { kind: "tag", pattern: "#archived", label: "#archived", count: 0, notes: null },
      ]);
    });

    it("lists each linked property after the tags, labeled key: value, counting the notes the manifest includes for it — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      const rows = buildLinkedMatchRows(
        taggedVault(),
        { tags: ["#q4"], properties: ["[status:active]", "[status:]", "[owner:]"] },
        new Set()
      );

      expect(rows.map(({ kind, label, count }) => [kind, label, count])).toEqual([
        ["tag", "#q4", 2],
        ["property", "status: active", 2],
        ["property", "status: (any)", 3],
        ["property", "owner: (any)", 0],
      ]);
      expect(rows[1].pattern).toBe("[status:active]");
    });

    it("lists an expanded tag's or property's notes by name with the folder each sits in, sorted by path", () => {
      const [tag, property] = buildLinkedMatchRows(
        taggedVault(),
        { tags: ["#launch"], properties: ["[status:active]"] },
        new Set(["#launch", "[status:active]"])
      );

      expect(tag.notes?.map((note) => [note.node.name, note.parent])).toEqual([
        ["brief.md", "Plans/"],
        ["standup.md", "Work/"],
      ]);
      expect(property.notes?.map((note) => note.node.path)).toEqual([
        "Plans/brief.md",
        "Work/standup.md",
      ]);
    });

    it("returns the same empty list when no tag or property is linked", () => {
      const first = buildLinkedMatchRows(taggedVault(), { tags: [], properties: [] }, new Set());
      const second = buildLinkedMatchRows(taggedVault(), { tags: [], properties: [] }, new Set());

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
      onUnlink: jest.fn(),
      onOpenUrl: jest.fn(),
      onUnlinkUrl: jest.fn(),
    };
    beforeEach(() => Object.values(handlers).forEach((handler) => handler.mockClear()));
    const NO_MATCHES: LinkedMatchRow[] = [];
    const NO_URLS: ReturnType<typeof createUrlItem>[] = [];
    const MATCHES: LinkedMatchRow[] = [
      {
        kind: "tag",
        pattern: "#launch",
        label: "#launch",
        count: 2,
        notes: [
          { node: { kind: "file", path: "Plans/brief.md", name: "brief.md" }, parent: "Plans/" },
          { node: { kind: "file", path: "Work/standup.md", name: "standup.md" }, parent: "Work/" },
        ],
      },
      { kind: "tag", pattern: "#q4", label: "#q4", count: 1, notes: null },
      {
        kind: "property",
        pattern: "[status:active]",
        label: "status: active",
        count: 1,
        notes: [
          { node: { kind: "file", path: "Work/standup.md", name: "standup.md" }, parent: "Work/" },
        ],
      },
    ];
    const URLS = [
      createUrlItem("https://example.com/pricing"),
      createUrlItem("https://youtu.be/dQw4w9WgXcQ"),
    ];
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
      render(<LinkedSection rows={ROWS} matches={NO_MATCHES} urls={NO_URLS} {...handlers} />);

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
          matches={NO_MATCHES}
          urls={NO_URLS}
          {...handlers}
        />
      );

      expect(within(linkedRegion()).getByText("Not found")).toBeTruthy();
    });

    it("says nothing is linked yet, with no drop hint, when the section is empty", () => {
      render(<LinkedSection rows={[]} matches={NO_MATCHES} urls={NO_URLS} {...handlers} />);

      expect(linkedRegion().textContent).toBe("LinkedNothing linked yet.");
    });

    it("unlinks an item by its saved link from its Unlink button without opening it", () => {
      render(<LinkedSection rows={ROWS} matches={NO_MATCHES} urls={NO_URLS} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: "Unlink Q3 retro.md" }));

      expect(handlers.onUnlink).toHaveBeenCalledWith("[[Q3 retro]]");
      expect(handlers.onOpenFile).not.toHaveBeenCalled();
    });

    it("lists linked tags and then properties after notes and folders, then links, each tag and property with its note count and each link by its address — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      render(<LinkedSection rows={ROWS} matches={MATCHES} urls={URLS} {...handlers} />);

      const rows = within(linkedRegion())
        .getAllByRole("button")
        .filter((button) => button.getAttribute("role") === "button")
        .map((row) => row.textContent);
      expect(rows).toEqual([
        "PricingResearch/",
        "Q3 retro.mdMeetings/",
        "#launch2 notes",
        "brief.mdPlans/",
        "standup.mdWork/",
        "#q41 note",
        "status: active1 note",
        "standup.mdWork/",
        "example.com/pricing",
        "youtu.be/dQw4w9WgXcQ",
      ]);
      expect(screen.getByRole("button", { name: /^#launch/ }).getAttribute("aria-expanded")).toBe(
        "true"
      );
      expect(screen.getByRole("button", { name: /^#q4/ }).getAttribute("aria-expanded")).toBe(
        "false"
      );
    });

    it("expands or collapses a tag from its row, like a folder", () => {
      render(<LinkedSection rows={[]} matches={MATCHES} urls={NO_URLS} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: /^#q4/ }));

      expect(handlers.onToggleFolder).toHaveBeenCalledWith("#q4");
    });

    it("opens a clicked link by its full address", () => {
      render(<LinkedSection rows={[]} matches={NO_MATCHES} urls={URLS} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: "youtu.be/dQw4w9WgXcQ" }));

      expect(handlers.onOpenUrl).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
    });

    it("unlinks a tag or property by its saved pattern and a link by its saved address, without opening any", () => {
      render(<LinkedSection rows={[]} matches={MATCHES} urls={URLS} {...handlers} />);

      fireEvent.click(screen.getByRole("button", { name: "Unlink status: active" }));
      expect(handlers.onUnlink).toHaveBeenCalledWith("[status:active]");
      fireEvent.click(screen.getByRole("button", { name: "Unlink #q4" }));
      fireEvent.click(screen.getByRole("button", { name: "Unlink example.com/pricing" }));

      expect(handlers.onUnlink).toHaveBeenCalledWith("#q4");
      expect(handlers.onUnlinkUrl).toHaveBeenCalledWith(URLS[0]);
      expect(handlers.onToggleFolder).not.toHaveBeenCalled();
      expect(handlers.onOpenUrl).not.toHaveBeenCalled();
    });

    it("offers no file menu and no drag on tag, property and link rows, which are not files, but keeps both on the notes under them — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      render(<LinkedSection rows={[]} matches={MATCHES} urls={URLS} {...handlers} />);
      const tag = screen.getByRole("button", { name: /^#launch/ });
      const property = screen.getByRole("button", { name: /^status: active/ });
      const link = screen.getByRole("button", { name: "example.com/pricing" });
      const note = screen.getByRole("button", { name: /^brief\.md/ });

      for (const row of [tag, property, link]) {
        fireEvent.contextMenu(row);
        expect(row.getAttribute("draggable")).toBe("false");
      }
      expect(handlers.onShowFileMenu).not.toHaveBeenCalled();
      fireEvent.contextMenu(note);
      expect(handlers.onShowFileMenu).toHaveBeenCalledWith("Plans/brief.md", expect.anything());
      expect(note.getAttribute("draggable")).toBe("true");
    });
  });

  describe("ProjectFilesPanel()", () => {
    it("offers Files, Folders, Tags, Properties and Link from Link context and reports the kind chosen", () => {
      const onLink = jest.fn();
      render(
        <ProjectFilesPanel onLink={onLink}>
          <div />
        </ProjectFilesPanel>
      );

      fireEvent.pointerDown(screen.getByRole("button", { name: "Link context" }), {
        button: 0,
        ctrlKey: false,
      });
      const menu = screen.getByRole("menu");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent)
      ).toEqual(["Files", "Folders", "Tags", "Properties", "Link"]);
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Folders" }));

      expect(onLink).toHaveBeenCalledWith("folders");
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

    function dropOverlay(): HTMLElement | null {
      return within(dropZone()).queryByText("Link files to this project");
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

    it("places Link context below the last linked item, at the bottom of the Files tab", () => {
      linkPatterns(["[[Q3 retro]]", "Research/Pricing"]);
      const { vault } = linkedFixture();
      const { container } = renderView(vault);

      const lastRow = within(screen.getByRole("region", { name: "Linked" })).getByRole("button", {
        name: /^Q3 retro/,
      });
      const linkContext = screen.getByRole("button", { name: "Link context" });
      expect(
        lastRow.compareDocumentPosition(linkContext) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(container.textContent?.endsWith("Link context")).toBe(true);
    });

    it("keeps Link context outside the scrolling list of sections so it stays in view while the list scrolls", () => {
      linkPatterns(["[[Q3 retro]]", "Research/Pricing"]);
      const { vault } = linkedFixture();
      renderView(vault);

      const scrollList = screen
        .getByRole("region", { name: "Linked" })
        .closest("[data-radix-scroll-area-viewport]");
      expect(scrollList?.contains(screen.getByRole("region", { name: "Project folder" }))).toBe(
        true
      );
      expect(scrollList?.contains(screen.getByRole("button", { name: "Link context" }))).toBe(
        false
      );
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

    it("links the nested folder chosen from Link context's Folders picker by its full vault path", async () => {
      const { vault } = linkedFixture();
      renderView(vault);

      chooseLinkKind("Folders");
      const [kind, chooseFolder] = mockOpenPicker.mock.calls[0];
      expect(kind).toBe("folders");
      act(() => {
        chooseFolder("Work/Notes");
      });

      await waitFor(() => expect(linkedNames()).toEqual(["Notes"]));
      expect(savedPatterns()).toEqual(["Work/Notes"]);
      expect(noticeMessages()).toContain("Linked Notes to the project");
    });

    it("links the note chosen from Link context's Files picker by its [[name]] link", async () => {
      const { vault, retro } = linkedFixture();
      renderView(vault);

      chooseLinkKind("Files");
      const [kind, chooseFile] = mockOpenPicker.mock.calls[0];
      expect(kind).toBe("files");
      act(() => {
        chooseFile(retro);
      });

      await waitFor(() => expect(linkedNames()).toEqual(["Q3 retro.md"]));
      expect(savedPatterns()).toEqual(["[[Q3 retro]]"]);
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

    it("is its own drop zone, so the composer's overlay and attachment skip it, and says Link files to this project while a vault item is dragged over", () => {
      const { vault, workNotes } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "folder", file: workNotes });

      const dragOver = fireEvent.dragOver(dropZone(), {
        dataTransfer: { types: ["text/plain"], dropEffect: "none" },
      });
      expect(dragOver).toBe(false);
      expect(dropOverlay()).not.toBeNull();

      fireEvent.dragLeave(dropZone(), { relatedTarget: null });
      expect(dropOverlay()).toBeNull();
    });

    it("hides the drop overlay when a drag over it ends without a drop or dragleave, as when Escape cancels it — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", () => {
      const { vault, workNotes } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "folder", file: workNotes });
      fireEvent.dragOver(dropZone(), { dataTransfer: { types: ["text/plain"] } });
      expect(dropOverlay()).not.toBeNull();

      fireEvent.dragEnd(document);

      expect(dropOverlay()).toBeNull();
    });

    it("ignores a drag of its own rows, so moving a row toward the message box neither shows the drop overlay nor links — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", () => {
      const { vault, timeline } = linkedFixture();
      renderView(vault);
      vault.setDraggable({ type: "link", file: timeline });
      const dataTransfer = { types: ["copilot/internal-drag", "text/plain"], files: [] };

      const dragOver = fireEvent.dragOver(dropZone(), { dataTransfer });
      fireEvent.drop(dropZone(), { dataTransfer });

      expect(dragOver).toBe(true);
      expect(dropOverlay()).toBeNull();
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

    it("refuses a folder dropped from the computer with a notice and copies nothing — https://github.com/Brevilabs/obsidian-copilot-private/issues/897", async () => {
      const { vault } = linkedFixture();
      renderView(vault);
      const folder = { name: "my-codebase", arrayBuffer: async () => new ArrayBuffer(0) };
      const item = { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) };

      fireEvent.drop(dropZone(), {
        dataTransfer: { types: ["Files"], files: [folder], items: [item] },
      });

      await waitFor(() =>
        expect(noticeMessages()).toContain(
          "Folders from outside the vault can't be added: my-codebase. Move the folder into your vault, or drop the files you need."
        )
      );
      expect(vault.createBinary).not.toHaveBeenCalled();
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

    function taggedFixture() {
      const brief = makeFile("Plans/brief.md");
      const standup = makeFile("Work/standup.md");
      const budget = makeFile("Plans/budget.md");
      const vault = makeFakeVault(makeProjectFolder().root, [
        makeFolder("Plans", [brief, budget]),
        makeFolder("Work", [standup]),
        makeFolder("Meetings", [makeFile("Meetings/Q3 retro.md")]),
      ]);
      vault.setTags(brief, { frontmatter: { tags: ["launch"] } });
      return { vault, brief, standup, budget };
    }

    it("shows a project's saved tag and its web and YouTube links under Linked, as the project editor saved them — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      linkPatterns(["#launch"], {
        webUrls: "https://example.com/brief",
        youtubeUrls: "https://youtu.be/dQw4w9WgXcQ",
      });
      const { vault } = taggedFixture();

      renderView(vault);

      expect(linkedNames()).toEqual(["#launch", "example.com/brief", "youtu.be/dQw4w9WgXcQ"]);
      expect(screen.getByRole("button", { name: /^#launch/ }).textContent).toBe("#launch1 note");
    });

    it("adds a note tagged inline or in its properties under an expanded tag without a reload, and drops a note once its tag is removed", () => {
      linkPatterns(["#launch"]);
      const { vault, brief, standup, budget } = taggedFixture();
      renderView(vault);
      fireEvent.click(screen.getByRole("button", { name: /^#launch/ }));
      expect(linkedNames()).toEqual(["#launch", "brief.md"]);

      vault.setTags(standup, { inlineTags: ["#launch"] });
      vault.setTags(budget, { frontmatter: { tags: ["launch"] } });
      expect(linkedNames()).toEqual(["#launch", "brief.md", "budget.md", "standup.md"]);
      expect(screen.getByRole("button", { name: /^#launch/ }).textContent).toBe("#launch3 notes");

      vault.setTags(brief, { frontmatter: { tags: [] } });
      expect(linkedNames()).toEqual(["#launch", "budget.md", "standup.md"]);
    });

    it("opens, drags and shows the file menu for a note under an expanded tag, like any other file row", () => {
      linkPatterns(["#launch"]);
      const { vault, brief } = taggedFixture();
      renderView(vault);
      fireEvent.click(screen.getByRole("button", { name: /^#launch/ }));
      const row = screen.getByRole("button", { name: /^brief\.md/ });

      fireEvent.click(row);
      fireEvent.contextMenu(row);
      fireEvent.dragStart(row, { dataTransfer: { setData: jest.fn() } });

      expect(vault.openFile).toHaveBeenCalledWith(brief);
      expect(vault.trigger).toHaveBeenCalledWith(
        "file-menu",
        expect.anything(),
        brief,
        "copilot-project-files"
      );
      expect(vault.onDragStart).toHaveBeenCalledWith(expect.anything(), {
        type: "link",
        linktext: "Plans/brief",
      });
    });

    it("opens a clicked link in the browser and fetches nothing", () => {
      linkPatterns([], { youtubeUrls: "https://youtu.be/dQw4w9WgXcQ" });
      const open = jest.spyOn(window, "open").mockReturnValue(null);
      try {
        renderView(taggedFixture().vault);

        fireEvent.click(screen.getByRole("button", { name: "youtu.be/dQw4w9WgXcQ" }));

        expect(open).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ", "_blank");
      } finally {
        open.mockRestore();
      }
    });

    it("unlinks a tag or a link and keeps every other saved source", async () => {
      linkPatterns(["#launch", "[[Q3 retro]]"], {
        webUrls: "https://example.com/brief",
        youtubeUrls: "https://youtu.be/dQw4w9WgXcQ",
      });
      renderView(taggedFixture().vault);

      fireEvent.click(screen.getByRole("button", { name: "Unlink #launch" }));
      await waitFor(() => expect(savedPatterns()).toEqual(["[[Q3 retro]]"]));
      fireEvent.click(screen.getByRole("button", { name: "Unlink example.com/brief" }));

      await waitFor(() => expect(linkedNames()).toEqual(["Q3 retro.md", "youtu.be/dQw4w9WgXcQ"]));
      expect(getCachedProjectRecordById("q4")?.project.contextSource).toEqual({
        inclusions: inclusionsOf(["[[Q3 retro]]"]),
        webUrls: "",
        youtubeUrls: "https://youtu.be/dQw4w9WgXcQ",
      });
    });

    it("links a tag chosen from Link context's Tags picker by its #tag pattern", async () => {
      renderView(taggedFixture().vault);

      chooseLinkKind("Tags");
      const [kind, chooseTag] = mockOpenPicker.mock.calls[0];
      expect(kind).toBe("tags");
      act(() => {
        chooseTag("launch");
      });

      await waitFor(() => expect(linkedNames()).toEqual(["#launch"]));
      expect(savedPatterns()).toEqual(["#launch"]);
      expect(noticeMessages()).toEqual(["Linked #launch to the project"]);
    });

    it("links the property pattern chosen from Link context's Properties picker and lists it as a property row — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", async () => {
      const { vault, brief } = taggedFixture();
      vault.setTags(brief, { frontmatter: { status: "active" } });
      renderView(vault);

      chooseLinkKind("Properties");
      const [kind, choosePattern] = mockOpenPicker.mock.calls[0];
      expect(kind).toBe("properties");
      act(() => {
        choosePattern("[status:active]");
      });

      await waitFor(() => expect(linkedNames()).toEqual(["status: active"]));
      expect(savedPatterns()).toEqual(["[status:active]"]);
      expect(screen.getByRole("button", { name: /^status: active/ }).textContent).toBe(
        "status: active1 note"
      );
    });

    it("links a web or YouTube link from Link context's Link picker, saving it by its kind", async () => {
      renderView(taggedFixture().vault);

      chooseLinkKind("Link");
      const [kind, chooseUrl] = mockOpenPicker.mock.calls[0];
      expect(kind).toBe("link");
      act(() => {
        chooseUrl(createUrlItem("https://youtu.be/dQw4w9WgXcQ"));
      });

      await waitFor(() => expect(linkedNames()).toEqual(["youtu.be/dQw4w9WgXcQ"]));
      expect(getCachedProjectRecordById("q4")?.project.contextSource.youtubeUrls).toBe(
        "https://youtu.be/dQw4w9WgXcQ"
      );
      expect(noticeMessages()).toEqual(["Linked https://youtu.be/dQw4w9WgXcQ to the project"]);
    });

    it("expands a linked property to the notes that match it and updates them when a note's property changes, without a reload", () => {
      linkPatterns(["[status:active]"]);
      const { vault, brief, standup } = taggedFixture();
      vault.setTags(brief, { frontmatter: { status: "active" } });
      renderView(vault);
      fireEvent.click(screen.getByRole("button", { name: /^status: active/ }));
      expect(linkedNames()).toEqual(["status: active", "brief.md"]);

      vault.setTags(standup, { frontmatter: { status: ["Active", "q4"] } });
      expect(linkedNames()).toEqual(["status: active", "brief.md", "standup.md"]);

      vault.setTags(brief, { frontmatter: { status: "done" } });
      expect(linkedNames()).toEqual(["status: active", "standup.md"]);
      expect(screen.getByRole("button", { name: /^status: active/ }).textContent).toBe(
        "status: active1 note"
      );
    });

    it("unlinks only the chosen property pattern and leaves the notes and other links alone", async () => {
      linkPatterns(["#launch", "[status:active]", "[status:]"]);
      const { vault } = taggedFixture();
      renderView(vault);

      fireEvent.click(screen.getByRole("button", { name: "Unlink status: active" }));

      await waitFor(() => expect(savedPatterns()).toEqual(["#launch", "[status:]"]));
      expect(linkedNames()).toEqual(["#launch", "status: (any)"]);
      expect(vault.promptForDeletion).not.toHaveBeenCalled();
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

    it.each(["csv", "txt", "ts"])(
      "starts an Obsidian link drag for a %s output accepted by Agent Mode — https://github.com/Brevilabs/obsidian-copilot-private/issues/462",
      (extension) => {
        const path = `${PROJECT_FOLDER}/metrics.${extension}`;
        const root = makeFolder(PROJECT_FOLDER, [makeFile(path)]);
        const vault = makeFakeVault(root);
        renderView(vault);

        const started = fireEvent.dragStart(
          screen.getByRole("button", { name: `metrics.${extension}` }),
          {
            dataTransfer: { setData: jest.fn() },
          }
        );

        expect(started).toBe(true);
        expect(vault.onDragStart).toHaveBeenCalledWith(expect.anything(), {
          type: "link",
          linktext: path,
        });
      }
    );

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

    it("stops listening to the vault and the metadata cache once unmounted", () => {
      const { root } = makeProjectFolder();
      const vault = makeFakeVault(root);
      const { unmount } = renderView(vault);
      expect(vault.listenerCount()).toBe(5);

      unmount();

      expect(vault.listenerCount()).toBe(0);
    });
  });
});
