import { TFile } from "obsidian";
import { parseProjectConfigFile, sanitizeVaultPathSegment } from "@/projects/projectUtils";
import { mockTFile } from "@/__tests__/mockObsidian";

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

// Helper: set up the global `app` mock used by parseProjectConfigFile
function setupAppMock(rawContent: string, frontmatter: Record<string, unknown> | null) {
  (window as unknown as Record<string, unknown>).app = {
    vault: {
      read: jest.fn().mockResolvedValue(rawContent),
      // Reason: parseProjectConfigFile uses `cachedFile instanceof TFile` to detect synthetic TFiles.
      // Return an object with TFile prototype so tests exercise the vault.read() path by default.
      getAbstractFileByPath: jest.fn((path: string) =>
        Object.assign(Object.create(TFile.prototype), { path })
      ),
      adapter: { read: jest.fn().mockResolvedValue(rawContent) },
    },
    metadataCache: {
      // Reason: returning null forces the fallback YAML parse path in parseProjectConfigFile
      getFileCache: jest.fn().mockReturnValue(frontmatter ? { frontmatter } : null),
    },
  };
}

describe("parseProjectConfigFile", () => {
  const VALID_PATH = "copilot-projects/my-project/project.md";

  it("returns null when YAML frontmatter is malformed", async () => {
    // Malformed YAML: unbalanced braces cause a parse error
    const malformedContent = "---\nname: {bad: yaml: here\n---\nBody text";
    // Force the metadata-cache miss so the fallback YAML parser runs
    setupAppMock(malformedContent, null);

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(file);

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
    setupAppMock(rawContent, {
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
    const result = await parseProjectConfigFile(file);

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

    setupAppMock(rawContent, {
      "copilot-project-name": "My Project",
    });

    const file = makeMockFile(VALID_PATH);
    const result = await parseProjectConfigFile(file);

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
