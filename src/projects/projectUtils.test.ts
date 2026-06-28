import { App, TFile, TFolder } from "obsidian";
import {
  parseProjectConfigFile,
  sanitizeVaultPathSegment,
  scanAllProjectConfigFiles,
} from "@/projects/projectUtils";
import { getProjectFolderNameFromConfigPath, isProjectConfigFile } from "@/projects/projectPaths";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";

// Mock deep dependencies to avoid transitive import chains
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

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

// Helper: create a minimal TFile mock for a project config path
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

// Helper: build the `app` mock passed to parseProjectConfigFile
function setupAppMock(rawContent: string, frontmatter: Record<string, unknown> | null): App {
  const app = {
    vault: {
      read: jest.fn().mockResolvedValue(rawContent),
      // Reason: parseProjectConfigFile uses `cachedFile instanceof TFile` to detect synthetic TFiles.
      // Return an object with TFile prototype so tests exercise the vault.read() path by default.
      getAbstractFileByPath: jest.fn((path: string): TFile => mockTFile({ path })),
      adapter: { read: jest.fn().mockResolvedValue(rawContent) },
    },
    metadataCache: {
      // Reason: returning null forces the fallback YAML parse path in parseProjectConfigFile
      getFileCache: jest.fn().mockReturnValue(frontmatter ? { frontmatter } : null),
    },
  } as unknown as App;
  return app;
}

describe("parseProjectConfigFile", () => {
  const VALID_PATH = "copilot-projects/my-project/project.md";

  it("returns null when YAML frontmatter is malformed", async () => {
    // Malformed YAML: unbalanced braces cause a parse error
    const malformedContent = "---\nname: {bad: yaml: here\n---\nBody text";
    // Force the metadata-cache miss so the fallback YAML parser runs
    const app = setupAppMock(malformedContent, null);

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(app, file);

    expect(result).toBeNull();
  });

  it("correctly parses valid frontmatter with all fields", async () => {
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

    // Use metadata-cache path (non-null frontmatter) for the happy path
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

    // Reason: files without copilot-project-id are treated as corrupted and skipped.
    // With name-based folders, folderName can no longer serve as id fallback.
    expect(result).toBeNull();
  });
});

describe("sanitizeVaultPathSegment", () => {
  it("blocks path traversal with ../", () => {
    // Reason: the slash is the dangerous part — removing it prevents escaping the project folder.
    // The dots themselves are harmless once the separator is gone.
    const result = sanitizeVaultPathSegment("../foo");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result.length).toBeGreaterThan(0);
  });

  it("replaces forward slashes in nested paths", () => {
    // "foo/bar" would escape the project folder — slash must be replaced
    const result = sanitizeVaultPathSegment("foo/bar");
    expect(result).not.toContain("/");
  });

  it("handles double-dot without slash (foo..bar)", () => {
    // "foo..bar" is not a traversal segment but should pass through safely
    const result = sanitizeVaultPathSegment("foo..bar");
    // Must not be empty and must not equal the traversal sentinels
    expect(result).not.toBe(".");
    expect(result).not.toBe("..");
    expect(result.length).toBeGreaterThan(0);
  });

  it("replaces all invalid filename characters with underscores", () => {
    const result = sanitizeVaultPathSegment('<>:"/\\|?*');
    expect(result).toBe("_________");
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("handles mixed valid and invalid characters", () => {
    const result = sanitizeVaultPathSegment("My Project: v1.0 <beta>");
    expect(result).not.toContain(":");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("My Project");
  });

  it("preserves CJK characters unchanged", () => {
    expect(sanitizeVaultPathSegment("我的项目")).toBe("我的项目");
    expect(sanitizeVaultPathSegment("プロジェクト")).toBe("プロジェクト");
    expect(sanitizeVaultPathSegment("프로젝트")).toBe("프로젝트");
  });

  it("preserves emoji characters", () => {
    const result = sanitizeVaultPathSegment("🎵 Piano Notes");
    expect(result).toContain("🎵");
    expect(result).toContain("Piano Notes");
  });

  it("does not truncate long names", () => {
    const longName = "a".repeat(300);
    expect(sanitizeVaultPathSegment(longName)).toBe(longName);
  });

  it("converts all-special-characters to underscores", () => {
    expect(sanitizeVaultPathSegment("***")).toBe("___");
  });

  it("returns fallback for whitespace-only input", () => {
    expect(sanitizeVaultPathSegment("   ")).toBe("_");
  });

  it("strips trailing dots and spaces (Windows compat)", () => {
    expect(sanitizeVaultPathSegment("project...")).toBe("project");
    expect(sanitizeVaultPathSegment("project   ")).toBe("project");
    expect(sanitizeVaultPathSegment("project. . .")).toBe("project");
  });

  it("prefixes Windows reserved device names", () => {
    expect(sanitizeVaultPathSegment("CON")).toBe("_CON");
    expect(sanitizeVaultPathSegment("prn")).toBe("_prn");
    expect(sanitizeVaultPathSegment("NUL")).toBe("_NUL");
    expect(sanitizeVaultPathSegment("COM1")).toBe("_COM1");
    expect(sanitizeVaultPathSegment("LPT9")).toBe("_LPT9");
  });

  it("replaces control characters with underscores", () => {
    expect(sanitizeVaultPathSegment("abc\x00def")).toBe("abc_def");
    expect(sanitizeVaultPathSegment("test\x1Fname")).toBe("test_name");
  });

  it("returns fallback for empty string", () => {
    expect(sanitizeVaultPathSegment("")).toBe("_");
  });

  it("converts lone dot and double-dot to fallback", () => {
    // Reason: "." and ".." have trailing dots stripped first, then become empty → fallback "_"
    expect(sanitizeVaultPathSegment(".")).toBe("_");
    expect(sanitizeVaultPathSegment("..")).toBe("_");
  });
});

// Helper: build a project config TFile mock under the mocked projects folder.
function makeConfigFile(folderName: string, fileName: string): TFile {
  const path = `copilot-projects/${folderName}/${fileName}`;
  return mockTFile({
    path,
    name: fileName,
    basename: fileName.replace(/\.md$/, ""),
    extension: "md",
  });
}

describe("isProjectConfigFile (project.md only)", () => {
  it("recognizes project.md but not the generated AGENTS.md mirror", () => {
    expect(isProjectConfigFile(makeConfigFile("my-project", "project.md"))).toBe(true);
    expect(isProjectConfigFile(makeConfigFile("my-project", "AGENTS.md"))).toBe(false);
  });

  it("rejects other markdown names in a project folder", () => {
    expect(isProjectConfigFile(makeConfigFile("my-project", "notes.md"))).toBe(false);
    expect(isProjectConfigFile(makeConfigFile("my-project", "readme.md"))).toBe(false);
  });

  it("rejects config files inside the unsupported/ backup folder", () => {
    expect(isProjectConfigFile(makeConfigFile("unsupported", "project.md"))).toBe(false);
  });

  it("rejects files that are not exactly two levels deep", () => {
    expect(isProjectConfigFile(makeConfigFile("nested/deeper", "project.md"))).toBe(false);
    const shallow = mockTFile({
      path: "copilot-projects/project.md",
      name: "project.md",
      basename: "project",
      extension: "md",
    });
    expect(isProjectConfigFile(shallow)).toBe(false);
  });
});

describe("getProjectFolderNameFromConfigPath (project.md only)", () => {
  it("extracts the folder name from a project.md path", () => {
    expect(getProjectFolderNameFromConfigPath("copilot-projects/foo/project.md")).toBe("foo");
  });

  it("returns null for unrecognized names (incl. AGENTS.md) or wrong depth", () => {
    expect(getProjectFolderNameFromConfigPath("copilot-projects/foo/AGENTS.md")).toBeNull();
    expect(getProjectFolderNameFromConfigPath("copilot-projects/foo/notes.md")).toBeNull();
    expect(getProjectFolderNameFromConfigPath("copilot-projects/project.md")).toBeNull();
    expect(getProjectFolderNameFromConfigPath("other/foo/project.md")).toBeNull();
  });
});

describe("scanAllProjectConfigFiles (project.md only)", () => {
  const PROJECTS_FOLDER = "copilot-projects";

  // Build an app whose projects folder contains the given folders, each mapping a config
  // file name to its raw content. metadataCache is empty so the YAML fallback parser runs.
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

  it("recognizes a project.md project", async () => {
    const app = setupScanApp({ beta: { "project.md": validConfig("beta") } });
    const { records } = await scanAllProjectConfigFiles(app);
    expect(records).toHaveLength(1);
    expect(records[0].project.id).toBe("beta");
    expect(records[0].filePath).toBe("copilot-projects/beta/project.md");
  });

  it("does NOT recognize an AGENTS.md-only folder (mirror is not a config)", async () => {
    const app = setupScanApp({ alpha: { "AGENTS.md": validConfig("alpha") } });
    const { records } = await scanAllProjectConfigFiles(app);
    expect(records).toHaveLength(0);
  });

  it("recognizes project.md and ignores a sibling AGENTS.md mirror in the same folder", async () => {
    const app = setupScanApp({
      gamma: { "AGENTS.md": validConfig("gamma"), "project.md": validConfig("gamma") },
    });
    const { records } = await scanAllProjectConfigFiles(app);
    expect(records).toHaveLength(1);
    expect(records[0].filePath).toBe("copilot-projects/gamma/project.md");
  });
});
