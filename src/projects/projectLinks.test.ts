import type { ProjectConfig } from "@/aiParams";
import { linkProjectItems, unlinkProjectPattern } from "@/projects/projectLinks";
import { getCachedProjectRecordById, updateCachedProjectRecords } from "@/projects/state";
import { App, TFile, TFolder } from "obsidian";

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
});
