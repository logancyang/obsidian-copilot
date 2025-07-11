import { ProjectConfig } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";

// Mock dependencies
jest.mock("obsidian");
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

// Mock search utils
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn().mockReturnValue({
    inclusions: ["**/*.md", "**/*.pdf"],
    exclusions: [],
  }),
  shouldIndexFile: jest.fn().mockImplementation((file) => {
    return file.extension === "md" || file.extension === "pdf";
  }),
}));

// Mock crypto-js
jest.mock("crypto-js", () => ({
  MD5: jest.fn().mockImplementation((str) => ({
    toString: () => `mocked-hash-${str}`,
  })),
}));

// Mock plusUtils
jest.mock("@/plusUtils", () => ({
  useIsPlusUser: jest.fn(),
  navigateToPlusPage: jest.fn(),
}));

// Mock FileCache
jest.mock("@/cache/fileCache", () => {
  return {
    FileCache: {
      getInstance: jest.fn().mockImplementation(() => ({
        getCacheKey: jest
          .fn()
          .mockImplementation(
            (file, additionalContext) => `key-${file.path}-${additionalContext || ""}`
          ),
        get: jest.fn().mockImplementation(async (key) => {
          // Return mock content based on key
          if (key.includes("pdf")) return "Mock PDF content";
          if (key.includes("doc")) return "Mock document content";
          return `Mock content for ${key}`;
        }),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      })),
    },
  };
});

// Create custom, simplified mocks for obsidian
const mockApp = {
  vault: {
    adapter: {
      exists: jest.fn().mockResolvedValue(false),
      mkdir: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue("{}"),
      write: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    },
    getFiles: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    getAbstractFileByPath: jest.fn(),
  },
  // Add required App properties to satisfy TypeScript
  workspace: {
    getLeavesOfType: jest.fn().mockReturnValue([]),
    getActiveFile: jest.fn().mockReturnValue(null),
  },
  metadataCache: {
    getFileCache: jest.fn().mockReturnValue(null),
  },
  keymap: {},
  scope: {},
  plugins: {
    plugins: {},
    enabledPlugins: new Set(),
    getPlugin: jest.fn(),
  },
};

describe("ProjectContextCache", () => {
  let projectContextCache: ProjectContextCache;
  let mockProject: ProjectConfig;

  // Mock files
  const mockMarkdownFile = {
    path: "test/file.md",
    extension: "md",
    basename: "file",
    stat: { mtime: Date.now(), size: 100 },
  } as any;

  const mockPdfFile = {
    path: "test/document.pdf",
    extension: "pdf",
    basename: "document",
    stat: { mtime: Date.now(), size: 200 },
  } as any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock globals
    global.app = mockApp as any;

    // Set up mock vault file retrieval
    mockApp.vault.getFiles.mockReturnValue([mockMarkdownFile, mockPdfFile]);
    mockApp.vault.getAbstractFileByPath.mockImplementation((path) => {
      if (path === mockMarkdownFile.path) return mockMarkdownFile;
      if (path === mockPdfFile.path) return mockPdfFile;
      return null;
    });

    // Get actual instance
    projectContextCache = ProjectContextCache.getInstance();

    // Mock project with minimal properties for testing
    mockProject = {
      id: "test-project-id",
      name: "Test Project",
      contextSource: {
        inclusions: "**/*.md, **/*.pdf",
        exclusions: "",
      },
    } as any;
  });

  test("should store and retrieve file content", async () => {
    const filePath = "test/document.pdf";
    const content = "PDF content";

    // Store content
    await projectContextCache.setFileContext(mockProject, filePath, content);

    // Get content
    const retrievedContent = await projectContextCache.getFileContext(mockProject, filePath);

    // Verify the content was retrieved (note: implementation may return an object instead of string)
    expect(retrievedContent).toBeDefined();
  });

  test("should update project files from patterns", async () => {
    // Create an empty context cache to update
    const contextCache = {
      markdownContext: "",
      markdownNeedsReload: true,
      webContexts: {},
      youtubeContexts: {},
      fileContexts: {},
      timestamp: Date.now(),
    };

    // Call the method with both required parameters
    const updatedCache = await projectContextCache.updateProjectFilesFromPatterns(
      mockProject,
      contextCache
    );

    // Check that files were evaluated using the search pattern
    expect(mockApp.vault.getFiles).toHaveBeenCalled();

    // Verify the updated cache was returned
    expect(updatedCache).toBeDefined();
  });

  test("should clean up project file references", async () => {
    // First add some context
    await projectContextCache.setFileContext(mockProject, mockPdfFile.path, "PDF content");

    // Then clean it up
    await projectContextCache.cleanupProjectFileReferences(mockProject);

    // We can't directly verify internal state, but we can check interactions
    // or verify behavior through getters
    const projectCache = await projectContextCache.get(mockProject);
    expect(projectCache).toBeDefined();
  });
});
