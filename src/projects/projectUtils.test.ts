import { App, TFile, TFolder } from "obsidian";
import type { ProjectConfig } from "@/aiParams";
import {
  parseProjectConfigFile,
  scanAllProjectConfigFiles,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

jest.mock("@/settings/copilotFolder", () => {
  const { getSettings } = jest.requireMock<typeof import("@/settings/model")>("@/settings/model");
  return { getEffectiveProjectsFolder: jest.fn(() => getSettings().projectsFolder) };
});

jest.mock("@/projects/state", () => ({
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
  isPendingFileWrite: jest.fn(() => false),
  updateCachedProjectRecords: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

function makeMockFile(path: string): TFile {
  return mockTFile({
    path,
    name: "project.md",
    basename: "project",
    extension: "md",
    stat: { ctime: 1000, mtime: 1000, size: 0 },
    vault: {} as never,
    parent: null,
  });
}

function setupAppMock(rawContent: string, frontmatter: Record<string, unknown> | null): App {
  const app = {
    vault: {
      read: jest.fn().mockResolvedValue(rawContent),
      getAbstractFileByPath: jest.fn((path: string): TFile => mockTFile({ path })),
      adapter: { read: jest.fn().mockResolvedValue(rawContent) },
    },
    metadataCache: {
      getFileCache: jest.fn().mockReturnValue(frontmatter ? { frontmatter } : null),
    },
  } as unknown as App;
  return app;
}

function makeConfigFile(folderName: string, fileName: string): TFile {
  const path = `copilot-projects/${folderName}/${fileName}`;
  return mockTFile({
    path,
    name: fileName,
    basename: fileName.replace(/\.md$/, ""),
    extension: "md",
  });
}

describe("projectUtils", () => {
  describe("writeProjectFrontmatter()", () => {
    const timestamps = { createdMs: 1700000000000, lastUsedMs: 1700000001000 };
    const writeFor = async (
      project: Partial<ProjectConfig>,
      existing: Record<string, unknown> = {}
    ): Promise<Record<string, unknown>> => {
      const frontmatter = { ...existing };
      const app = {
        fileManager: {
          processFrontMatter: jest.fn(
            async (_file: TFile, update: (value: Record<string, unknown>) => void) =>
              update(frontmatter)
          ),
        },
      } as unknown as App;
      await writeProjectFrontmatter(
        app,
        makeMockFile("copilot-projects/my-project/project.md"),
        { id: " my-project ", name: "", ...project } as ProjectConfig,
        "my-project",
        timestamps
      );
      return frontmatter;
    };

    it("writes the project's identity, context source, and timestamps as copilot-project properties", async () => {
      const frontmatter = await writeFor({
        name: "My Project",
        description: "A test project",
        projectModelKey: "gpt-4",
        modelConfigs: { temperature: 0.7, maxTokens: 2048 },
        contextSource: {
          inclusions: "notes/",
          exclusions: "archive/",
          webUrls: "https://example.com\n\n https://example.org ",
          youtubeUrls: "",
        },
      });

      expect(frontmatter).toEqual({
        "copilot-project-id": "my-project",
        "copilot-project-name": "My Project",
        "copilot-project-description": "A test project",
        "copilot-project-model-key": "gpt-4",
        "copilot-project-temperature": 0.7,
        "copilot-project-max-tokens": 2048,
        "copilot-project-inclusions": "notes/",
        "copilot-project-exclusions": "archive/",
        "copilot-project-web-urls": ["https://example.com", "https://example.org"],
        "copilot-project-youtube-urls": [],
        "copilot-project-created": 1700000000000,
        "copilot-project-last-used": 1700000001000,
      });
    });

    it("names the project after its folder and clears stale model overrides when none are set", async () => {
      const frontmatter = await writeFor(
        {},
        { "copilot-project-temperature": 0.2, "copilot-project-max-tokens": 10, extra: "kept" }
      );

      expect(frontmatter["copilot-project-name"]).toBe("my-project");
      expect(frontmatter).not.toHaveProperty("copilot-project-temperature");
      expect(frontmatter).not.toHaveProperty("copilot-project-max-tokens");
      expect(frontmatter.extra).toBe("kept");
    });
  });

  describe("parseProjectConfigFile()", () => {
    const VALID_PATH = "copilot-projects/my-project/project.md";

    it("returns null when the YAML frontmatter is malformed", async () => {
      const malformedContent = "---\nname: {bad: yaml: here\n---\nBody text";
      const app = setupAppMock(malformedContent, null);

      const file = makeMockFile(VALID_PATH);
      const result = await parseProjectConfigFile(app, file);

      expect(result).toBeNull();
    });

    it("maps every copilot-project frontmatter field onto the project record", async () => {
      const rawContent = [
        "---",
        "copilot-project-id: my-project",
        "copilot-project-name: My Project",
        "copilot-project-description: A test project",
        "copilot-project-model-key: gpt-4",
        "copilot-project-temperature: 0.7",
        "copilot-project-max-tokens: 2048",
        "copilot-project-inclusions: notes/",
        "copilot-project-exclusions: archive/",
        "copilot-project-web-urls:",
        "  - https://example.com",
        "copilot-project-youtube-urls: []",
        "copilot-project-created: 1700000000000",
        "copilot-project-last-used: 1700000001000",
        "---",
        "System prompt body",
      ].join("\n");

      const app = setupAppMock(rawContent, {
        "copilot-project-id": "my-project",
        "copilot-project-name": "My Project",
        "copilot-project-description": "A test project",
        "copilot-project-model-key": "gpt-4",
        "copilot-project-temperature": 0.7,
        "copilot-project-max-tokens": 2048,
        "copilot-project-inclusions": "notes/",
        "copilot-project-exclusions": "archive/",
        "copilot-project-web-urls": ["https://example.com"],
        "copilot-project-youtube-urls": [],
        "copilot-project-created": 1700000000000,
        "copilot-project-last-used": 1700000001000,
      });

      const file = makeMockFile(VALID_PATH);
      const result = await parseProjectConfigFile(app, file);

      expect(result).not.toBeNull();
      expect(result!.project.id).toBe("my-project");
      expect(result!.project.name).toBe("My Project");
      expect(result!.project.description).toBe("A test project");
      expect(result!.project.projectModelKey).toBe("gpt-4");
      expect(result!.project.modelConfigs?.temperature).toBe(0.7);
      expect(result!.project.modelConfigs?.maxTokens).toBe(2048);
      expect(result!.project.contextSource?.inclusions).toBe("notes/");
      expect(result!.project.contextSource?.exclusions).toBe("archive/");
      expect(result!.project.contextSource?.webUrls).toBe("https://example.com");
      expect(result!.project.created).toBe(1700000000000);
      expect(result!.project.UsageTimestamps).toBe(1700000001000);
      expect(result!.filePath).toBe(VALID_PATH);
      expect(result!.folderName).toBe("my-project");
    });

    it("returns null when copilot-project-id is missing from frontmatter", async () => {
      const rawContent = ["---", "copilot-project-name: My Project", "---", "Body text"].join("\n");

      const app = setupAppMock(rawContent, {
        "copilot-project-name": "My Project",
      });

      const file = makeMockFile(VALID_PATH);
      const result = await parseProjectConfigFile(app, file);

      expect(result).toBeNull();
    });
  });

  describe("scanAllProjectConfigFiles()", () => {
    const PROJECTS_FOLDER = "copilot-projects";

    function setupScanApp(folders: Record<string, Record<string, string>>): App {
      const contentByPath = new Map<string, string>();
      const children: TFolder[] = [];

      for (const [folderName, configs] of Object.entries(folders)) {
        const files: TFile[] = [];
        for (const [fileName, content] of Object.entries(configs)) {
          const file = makeConfigFile(folderName, fileName);
          contentByPath.set(file.path, content);
          files.push(file);
        }
        children.push(mockTFolder({ name: folderName, children: files }));
      }

      const rootFolder = mockTFolder({ name: PROJECTS_FOLDER, children });

      return {
        vault: {
          getAbstractFileByPath: jest.fn((path: string) => {
            if (path === PROJECTS_FOLDER) return rootFolder;
            if (contentByPath.has(path)) {
              return makeConfigFile(path.split("/")[1], path.split("/").pop() ?? "");
            }
            return null;
          }),
          read: jest.fn((file: TFile) => Promise.resolve(contentByPath.get(file.path) ?? "")),
          adapter: { exists: jest.fn().mockResolvedValue(false), list: jest.fn() },
        },
        metadataCache: { getFileCache: jest.fn().mockReturnValue(null) },
      } as unknown as App;
    }

    const validConfig = (id: string): string =>
      ["---", `copilot-project-id: ${id}`, `copilot-project-name: ${id}`, "---", "body"].join("\n");

    it("returns a record for a folder whose project.md holds a valid project", async () => {
      const app = setupScanApp({ beta: { "project.md": validConfig("beta") } });
      const { records } = await scanAllProjectConfigFiles(app);
      expect(records).toHaveLength(1);
      expect(records[0].project.id).toBe("beta");
      expect(records[0].filePath).toBe("copilot-projects/beta/project.md");
    });

    it("skips a folder that only has an AGENTS.md mirror", async () => {
      const app = setupScanApp({ alpha: { "AGENTS.md": validConfig("alpha") } });
      const { records } = await scanAllProjectConfigFiles(app);
      expect(records).toHaveLength(0);
    });

    it("returns only the project.md record when an AGENTS.md mirror sits beside it", async () => {
      const app = setupScanApp({
        gamma: { "AGENTS.md": validConfig("gamma"), "project.md": validConfig("gamma") },
      });
      const { records } = await scanAllProjectConfigFiles(app);
      expect(records).toHaveLength(1);
      expect(records[0].filePath).toBe("copilot-projects/gamma/project.md");
    });
  });
});
