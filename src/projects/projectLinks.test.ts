import type { ProjectConfig } from "@/aiParams";
import {
  copyIntoProjectSources,
  getDraggedVaultItems,
  linkProjectItems,
  unlinkProjectPattern,
} from "@/projects/projectLinks";
import { getCachedProjectRecordById, updateCachedProjectRecords } from "@/projects/state";
import { App, TAbstractFile, TFile, TFolder } from "obsidian";

const mockUpdateProject = jest.fn();

jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ updateProject: mockUpdateProject }) },
}));

const PROJECT_FOLDER = "copilot/projects/q4-launch";

function makeFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function seedProject(contextSource: ProjectConfig["contextSource"]): void {
  updateCachedProjectRecords([
    {
      folderName: "q4-launch",
      filePath: `${PROJECT_FOLDER}/project.md`,
      project: {
        id: "q4",
        name: "Q4 Launch",
        systemPrompt: "Keep it short.",
        contextSource,
        created: 1,
        UsageTimestamps: 2,
      },
    },
  ]);
}

function savedContextSource(): ProjectConfig["contextSource"] | undefined {
  return getCachedProjectRecordById("q4")?.project.contextSource;
}

function savedInclusions(): string[] {
  return (savedContextSource()?.inclusions ?? "")
    .split(",")
    .filter(Boolean)
    .map((pattern) => decodeURIComponent(pattern));
}

function saveToCache(_projectId: string, next: ProjectConfig) {
  const record = getCachedProjectRecordById(next.id)!;
  updateCachedProjectRecords([{ ...record, project: next }]);
  return Promise.resolve(record);
}

function appWithDraggable(draggable: unknown): App {
  return { dragManager: { draggable } } as unknown as App;
}

beforeEach(() => {
  mockUpdateProject.mockReset().mockImplementation(saveToCache);
  seedProject({});
});

afterEach(() => {
  updateCachedProjectRecords([]);
});

describe("projectLinks", () => {
  describe("getDraggedVaultItems()", () => {
    it("returns the folder Obsidian is dragging as its own object, so a nested folder keeps its full path — https://github.com/logancyang/obsidian-copilot/issues/3089", () => {
      const nested = makeFolder("Clients/Northwind/Research");

      expect(getDraggedVaultItems(appWithDraggable({ type: "folder", file: nested }))).toEqual([
        nested,
      ]);
    });

    it("returns every item of a multi-item drag from the file explorer", () => {
      const note = makeFile("Meetings/Q3 retro.md");
      const folder = makeFolder("Research/Pricing");

      expect(
        getDraggedVaultItems(appWithDraggable({ type: "files", files: [note, folder] }))
      ).toEqual([note, folder]);
    });

    it("returns the note a link drag carries", () => {
      const note = makeFile("Meetings/Q3 retro.md");

      expect(
        getDraggedVaultItems(appWithDraggable({ type: "link", linktext: "Q3 retro", file: note }))
      ).toEqual([note]);
    });

    it("returns nothing when Obsidian is not dragging a vault item, as for a file from the computer", () => {
      expect(getDraggedVaultItems(appWithDraggable(null))).toEqual([]);
      expect(getDraggedVaultItems(appWithDraggable({ type: "link", linktext: "x" }))).toEqual([]);
      expect(getDraggedVaultItems({} as App)).toEqual([]);
    });
  });

  describe("linkProjectItems()", () => {
    it("saves a nested folder under its full vault path — https://github.com/logancyang/obsidian-copilot/issues/3089", async () => {
      await expect(
        linkProjectItems({} as App, "q4", [makeFolder("Clients/Northwind/Research")])
      ).resolves.toBe(true);

      expect(savedInclusions()).toEqual(["Clients/Northwind/Research"]);
    });

    it("links two same-named folders under different parents as two separate folders", async () => {
      await linkProjectItems({} as App, "q4", [makeFolder("Work/Notes")]);
      await linkProjectItems({} as App, "q4", [makeFolder("Personal/Notes")]);

      expect(savedInclusions()).toEqual(["Work/Notes", "Personal/Notes"]);
    });

    it("saves a note as its existing [[name]] link and keeps every other saved source and the project's details", async () => {
      seedProject({
        inclusions: encodeURIComponent("#launch"),
        exclusions: encodeURIComponent("Archive"),
        webUrls: "https://example.com/brief",
      });

      await linkProjectItems({} as App, "q4", [makeFile("Meetings/Q3 retro.md")]);

      expect(savedInclusions()).toEqual(["#launch", "[[Q3 retro]]"]);
      expect(savedContextSource()).toMatchObject({
        exclusions: encodeURIComponent("Archive"),
        webUrls: "https://example.com/brief",
      });
      expect(mockUpdateProject).toHaveBeenCalledWith(
        "q4",
        expect.objectContaining({ name: "Q4 Launch", systemPrompt: "Keep it short." })
      );
    });

    it("returns false and writes nothing when every item is already linked", async () => {
      seedProject({ inclusions: encodeURIComponent("Research/Pricing") });

      await expect(
        linkProjectItems({} as App, "q4", [makeFolder("Research/Pricing")])
      ).resolves.toBe(false);

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("rejects when the project is no longer in the project cache", async () => {
      updateCachedProjectRecords([]);

      await expect(linkProjectItems({} as App, "q4", [makeFolder("Meetings")])).rejects.toThrow(
        "Project not found"
      );
    });
  });

  describe("unlinkProjectPattern()", () => {
    it("removes only the unlinked item and leaves the original in the vault", async () => {
      seedProject({
        inclusions: ["#launch", "[[Q3 retro]]", "Research/Pricing"]
          .map(encodeURIComponent)
          .join(","),
      });
      const vault = { delete: jest.fn(), trash: jest.fn() };

      await expect(
        unlinkProjectPattern({ vault } as unknown as App, "q4", "Research/Pricing")
      ).resolves.toBe(true);

      expect(savedInclusions()).toEqual(["#launch", "[[Q3 retro]]"]);
      expect(vault.delete).not.toHaveBeenCalled();
      expect(vault.trash).not.toHaveBeenCalled();
    });

    it("keeps both unlinks when the second starts before the first is saved, so neither link comes back — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", async () => {
      seedProject({
        inclusions: ["Research/Pricing", "Meetings"].map(encodeURIComponent).join(","),
      });
      let releaseFirstSave!: () => void;
      const firstSave = new Promise<void>((resolve) => (releaseFirstSave = resolve));
      mockUpdateProject.mockImplementationOnce(async (projectId: string, next: ProjectConfig) => {
        await firstSave;
        return saveToCache(projectId, next);
      });

      const first = unlinkProjectPattern({} as App, "q4", "Research/Pricing");
      const second = unlinkProjectPattern({} as App, "q4", "Meetings");
      releaseFirstSave();
      await Promise.all([first, second]);

      expect(savedInclusions()).toEqual([]);
    });

    it("returns false and writes nothing for an item that is not linked", async () => {
      await expect(unlinkProjectPattern({} as App, "q4", "Research/Pricing")).resolves.toBe(false);

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  describe("copyIntoProjectSources()", () => {
    function makeVault(existingPaths: string[]) {
      const paths = new Set(existingPaths);
      const written = new Map<string, ArrayBuffer>();
      const vault = {
        getAbstractFileByPath: (path: string): TAbstractFile | null =>
          paths.has(path) ? makeFolder(path) : null,
        adapter: {
          exists: async (path: string) => paths.has(path),
          mkdir: async (path: string) => void paths.add(path),
        },
        createBinary: async (path: string, data: ArrayBuffer) => {
          if (paths.has(path)) throw new Error(`File already exists: ${path}`);
          paths.add(path);
          written.set(path, data);
          return makeFile(path);
        },
      };
      return { app: { vault } as unknown as App, paths, written };
    }

    function droppedFile(name: string, bytes: number[]): File {
      const data = new Uint8Array(bytes).buffer;
      return { name, arrayBuffer: async () => data } as unknown as File;
    }

    it("copies a file from the computer into the project's sources folder, creating the folder", async () => {
      const { app, paths, written } = makeVault([]);

      const copies = await copyIntoProjectSources(app, PROJECT_FOLDER, [
        droppedFile("board-notes.pdf", [37, 80, 68, 70]),
      ]);

      expect(copies.map((file) => file.path)).toEqual([
        `${PROJECT_FOLDER}/sources/board-notes.pdf`,
      ]);
      expect(paths.has(`${PROJECT_FOLDER}/sources`)).toBe(true);
      expect([
        ...new Uint8Array(written.get(`${PROJECT_FOLDER}/sources/board-notes.pdf`)!),
      ]).toEqual([37, 80, 68, 70]);
    });

    it("adds a number to the name instead of overwriting a file already in sources (https://github.com/Brevilabs/obsidian-copilot-private/issues/461)", async () => {
      const { app, written } = makeVault([
        `${PROJECT_FOLDER}/sources`,
        `${PROJECT_FOLDER}/sources/board-notes.pdf`,
        `${PROJECT_FOLDER}/sources/board-notes 1.pdf`,
      ]);

      const copies = await copyIntoProjectSources(app, PROJECT_FOLDER, [
        droppedFile("board-notes.pdf", [1]),
        droppedFile("README", [2]),
        droppedFile("README", [3]),
      ]);

      expect(copies.map((file) => file.path)).toEqual([
        `${PROJECT_FOLDER}/sources/board-notes 2.pdf`,
        `${PROJECT_FOLDER}/sources/README`,
        `${PROJECT_FOLDER}/sources/README 1`,
      ]);
      expect(written.has(`${PROJECT_FOLDER}/sources/board-notes.pdf`)).toBe(false);
    });
  });
});
