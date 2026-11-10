import type { ProjectConfig } from "@/aiParams";
import {
  copyIntoProjectSources,
  getProjectLinkPatterns,
  getProjectLinks,
  linkProjectItems,
  linkProjectPattern,
  linkProjectUrl,
  unlinkProjectPattern,
  unlinkProjectUrl,
} from "@/projects/projectLinks";
import { createUrlItem } from "@/lib/url-tag";
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

beforeEach(() => {
  mockUpdateProject.mockReset().mockImplementation(saveToCache);
  seedProject({});
});

afterEach(() => {
  updateCachedProjectRecords([]);
});

describe("projectLinks", () => {
  describe("getProjectLinks()", () => {
    function projectWith(patterns: string[]): ProjectConfig {
      return {
        id: "q4",
        name: "Q4 Launch",
        systemPrompt: "",
        contextSource: { inclusions: patterns.map(encodeURIComponent).join(",") },
        created: 1,
        UsageTimestamps: 2,
      };
    }

    it("reads the project's linked folders and notes from its saved context, without duplicates", () => {
      expect(
        getProjectLinks(
          projectWith(["Work/Notes", "[[Q3 retro]]", "Research/Pricing", "Work/Notes"])
        )
      ).toEqual({
        folders: ["Work/Notes", "Research/Pricing"],
        notes: ["[[Q3 retro]]"],
        tags: [],
        properties: [],
        urls: [],
      });
    });

    it("reads linked tags and the saved web and YouTube links next to folders and notes", () => {
      const project = projectWith(["#launch", "[[Plan]]"]);
      project.contextSource.webUrls = "https://example.com/brief";
      project.contextSource.youtubeUrls = "https://youtu.be/dQw4w9WgXcQ";

      const links = getProjectLinks(project);

      expect(links).toMatchObject({
        folders: [],
        notes: ["[[Plan]]"],
        tags: ["#launch"],
        properties: [],
      });
      expect(links.urls.map((item) => item.url)).toEqual([
        "https://example.com/brief",
        "https://youtu.be/dQw4w9WgXcQ",
      ]);
    });

    it("reads linked properties and leaves out saved file types, which the Files tab does not list", () => {
      expect(getProjectLinks(projectWith(["[status:active]", "*.pdf", "[[Plan]]"]))).toEqual({
        folders: [],
        notes: ["[[Plan]]"],
        tags: [],
        properties: ["[status:active]"],
        urls: [],
      });
    });

    it("returns the same empty links for a project with nothing linked or no project at all", () => {
      const none = getProjectLinks(undefined);

      expect(none).toEqual({ folders: [], notes: [], tags: [], properties: [], urls: [] });
      expect(getProjectLinks(projectWith([]))).toBe(none);
      expect(getProjectLinks(projectWith(["*.pdf"]))).toBe(none);
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

  describe("linkProjectPattern()", () => {
    it("adds a tag beside the saved notes and folders in the shape the project editor saves it", async () => {
      seedProject({
        inclusions: ["[[Q3 retro]]", "Research/Pricing"].map(encodeURIComponent).join(","),
      });

      await expect(linkProjectPattern({} as App, "q4", "#launch")).resolves.toBe(true);

      expect(savedContextSource()?.inclusions).toBe(
        "%23launch,%5B%5BQ3%20retro%5D%5D,Research%2FPricing"
      );
    });

    it("returns false and writes nothing for a tag that is already linked", async () => {
      seedProject({ inclusions: encodeURIComponent("#launch") });

      await expect(linkProjectPattern({} as App, "q4", "#launch")).resolves.toBe(false);

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  describe("linkProjectUrl()", () => {
    it("saves a web page under web URLs and a YouTube video under YouTube URLs, keeping the other saved sources", async () => {
      seedProject({
        inclusions: encodeURIComponent("#launch"),
        webUrls: "https://example.com/brief",
      });

      await linkProjectUrl({} as App, "q4", createUrlItem("https://example.com/pricing"));
      await linkProjectUrl({} as App, "q4", createUrlItem("https://youtu.be/dQw4w9WgXcQ"));

      expect(savedContextSource()).toEqual({
        inclusions: encodeURIComponent("#launch"),
        webUrls: "https://example.com/brief\nhttps://example.com/pricing",
        youtubeUrls: "https://youtu.be/dQw4w9WgXcQ",
      });
    });

    it("returns false and writes nothing for a link that is already saved", async () => {
      seedProject({ webUrls: "https://example.com/brief" });

      await expect(
        linkProjectUrl({} as App, "q4", createUrlItem("https://example.com/brief"))
      ).resolves.toBe(false);

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  describe("unlinkProjectUrl()", () => {
    it("removes only that link and leaves the other links and sources as saved", async () => {
      seedProject({
        inclusions: encodeURIComponent("#launch"),
        webUrls: "https://example.com/brief\nhttps://example.com/pricing",
        youtubeUrls: "https://youtu.be/dQw4w9WgXcQ",
      });

      await expect(
        unlinkProjectUrl({} as App, "q4", createUrlItem("https://youtu.be/dQw4w9WgXcQ"))
      ).resolves.toBe(true);
      await unlinkProjectUrl({} as App, "q4", createUrlItem("https://example.com/brief"));

      expect(savedContextSource()).toEqual({
        inclusions: encodeURIComponent("#launch"),
        webUrls: "https://example.com/pricing",
        youtubeUrls: "",
      });
    });

    it("keeps both a link unlink and a tag unlink when the second starts before the first is saved, so neither comes back — https://github.com/Brevilabs/obsidian-copilot-private/issues/461", async () => {
      seedProject({
        inclusions: encodeURIComponent("#launch"),
        webUrls: "https://example.com/brief",
      });
      let releaseFirstSave!: () => void;
      const firstSave = new Promise<void>((resolve) => (releaseFirstSave = resolve));
      mockUpdateProject.mockImplementationOnce(async (projectId: string, next: ProjectConfig) => {
        await firstSave;
        return saveToCache(projectId, next);
      });

      const first = unlinkProjectUrl({} as App, "q4", createUrlItem("https://example.com/brief"));
      const second = unlinkProjectPattern({} as App, "q4", "#launch");
      releaseFirstSave();
      await Promise.all([first, second]);

      expect(savedInclusions()).toEqual([]);
      expect(savedContextSource()?.webUrls).toBe("");
    });

    it("returns false and writes nothing for a link that is not saved", async () => {
      await expect(
        unlinkProjectUrl({} as App, "q4", createUrlItem("https://example.com/brief"))
      ).resolves.toBe(false);

      expect(mockUpdateProject).not.toHaveBeenCalled();
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

  describe("getProjectLinkPatterns()", () => {
    function projectWith(patterns: string[]): ProjectConfig {
      return {
        id: "q4",
        name: "Q4 Launch",
        systemPrompt: "",
        contextSource: {
          inclusions: patterns.map(encodeURIComponent).join(","),
          exclusions: encodeURIComponent("Research"),
        },
        created: 1,
        UsageTimestamps: 2,
      };
    }

    it("returns the project's linked folders, notes, tags and properties as vault patterns", () => {
      expect(
        getProjectLinkPatterns(projectWith(["Research", "[[Spec]]", "#launch", "[topic:physics]"]))
      ).toEqual({
        folderPatterns: ["Research"],
        notePatterns: ["[[Spec]]"],
        tagPatterns: ["#launch"],
        propertyPatterns: ["[topic:physics]"],
      });
    });

    it("ignores saved file-type patterns and exclusions, which no longer shape project context — https://github.com/Brevilabs/obsidian-copilot-private/issues/841", () => {
      expect(getProjectLinkPatterns(projectWith(["*.pdf", "Research"]))).toEqual({
        folderPatterns: ["Research"],
        notePatterns: [],
        tagPatterns: [],
        propertyPatterns: [],
      });
      expect(getProjectLinkPatterns(projectWith(["*.pdf", "*.docx"]))).toBeNull();
    });

    it("returns null for a project with nothing linked or no project", () => {
      expect(getProjectLinkPatterns(projectWith([]))).toBeNull();
      expect(getProjectLinkPatterns(undefined)).toBeNull();
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

    it("gives each of two overlapping drops of the same file name its own copy (https://github.com/Brevilabs/obsidian-copilot-private/issues/461)", async () => {
      const { app } = makeVault([`${PROJECT_FOLDER}/sources`]);

      const [first, second] = await Promise.all([
        copyIntoProjectSources(app, PROJECT_FOLDER, [droppedFile("board-notes.pdf", [1])]),
        copyIntoProjectSources(app, PROJECT_FOLDER, [droppedFile("board-notes.pdf", [2])]),
      ]);

      expect([...first, ...second].map((file) => file.path)).toEqual([
        `${PROJECT_FOLDER}/sources/board-notes.pdf`,
        `${PROJECT_FOLDER}/sources/board-notes 1.pdf`,
      ]);
    });
  });
});
