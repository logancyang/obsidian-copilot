import * as searchUtils from "@/search/searchUtils";
import { ToolManager } from "@/tools/toolManager";
import { TFolder } from "obsidian";
import { buildFileTree, createGetFileTreeTool } from "./FileTreeTools";

// Mock the searchUtils functions
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  shouldIndexFile: jest.fn(),
}));

// Mock TFile class
class MockTFile {
  vault: any;
  stat: { ctime: number; mtime: number; size: number };
  basename: string;
  extension: string;
  name: string;
  parent: TFolder;
  path: string;

  constructor(path: string, parent: TFolder) {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.basename = this.name.split(".")[0];
    this.extension = this.name.split(".")[1] || "";
    this.parent = parent;
    this.vault = {};
    this.stat = {
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0,
    };
  }
}

// Mock TFolder class
class MockTFolder {
  vault: any;
  name: string;
  path: string;
  parent: TFolder | null;
  children: Array<MockTFile | MockTFolder>;

  constructor(path: string, parent: TFolder | null) {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.parent = parent;
    this.vault = {};
    this.children = [];
  }

  isRoot(): boolean {
    return this.parent === null;
  }
}

describe("FileTreeTools", () => {
  let root: MockTFolder;

  beforeEach(() => {
    root = new MockTFolder("", null);

    // Create a mock file structure
    const docs = new MockTFolder("docs", root);
    const projects = new MockTFolder("docs/projects", docs);
    const notes = new MockTFolder("docs/notes", docs);

    docs.children = [projects, notes, new MockTFile("docs/readme.md", docs)];

    projects.children = [
      new MockTFile("docs/projects/project1.md", projects),
      new MockTFile("docs/projects/project2.md", projects),
      new MockTFile("docs/projects/data.json", projects),
    ];

    notes.children = [
      new MockTFile("docs/notes/note1.md", notes),
      new MockTFile("docs/notes/note2.md", notes),
      new MockTFile("docs/notes/image.png", notes),
    ];

    root.children = [
      docs,
      new MockTFile("readme.md", root),
      new MockTFile("config.json", root),
      new MockTFile("text", root),
    ];

    // Reset mocks before each test
    jest.clearAllMocks();

    // Default mock implementations
    (searchUtils.getMatchingPatterns as jest.Mock).mockReturnValue({
      inclusions: null,
      exclusions: null,
    });
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(true);
  });

  it("should generate correct file tree structure with files and extension counts", async () => {
    // Test buildFileTree function directly
    const tree = buildFileTree(root);

    // Define expected tree structure
    const expectedTree = {
      vault: {
        files: ["readme.md", "config.json", "text"],
        subFolders: {
          docs: {
            files: ["readme.md"],
            subFolders: {
              projects: {
                files: ["project1.md", "project2.md", "data.json"],
                extensionCounts: { md: 2, json: 1 },
              },
              notes: {
                files: ["note1.md", "note2.md", "image.png"],
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 5, json: 1, png: 1 },
          },
        },
        extensionCounts: { md: 6, json: 2, png: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);

    // Also test the tool to ensure it uses buildFileTree correctly
    const tool = createGetFileTreeTool(root);
    const result = await ToolManager.callTool(tool, {});

    // Extract JSON part after the prompt
    const jsonPart = result.substring(result.indexOf("{"));
    const treeFromTool = JSON.parse(jsonPart);

    expect(treeFromTool).toEqual(expectedTree);
  });

  it("should handle size limit by rebuilding without files", async () => {
    // Test buildFileTree with size limit handling
    const tree = buildFileTree(root, false);

    // Define expected simplified tree structure
    const expectedTree = {
      vault: {
        subFolders: {
          docs: {
            subFolders: {
              projects: {
                extensionCounts: { md: 2, json: 1 },
              },
              notes: {
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 5, json: 1, png: 1 },
          },
        },
        extensionCounts: { md: 6, json: 2, png: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);
  });

  it("should exclude files based on patterns", async () => {
    // Mock shouldIndexFile to exclude all files in projects folder
    (searchUtils.shouldIndexFile as jest.Mock).mockImplementation((file) => {
      return !file.path.includes("projects");
    });

    // Test buildFileTree with exclusion patterns
    const tree = buildFileTree(root);

    // Define expected tree with projects excluded
    const expectedTree = {
      vault: {
        files: ["readme.md", "config.json", "text"],
        subFolders: {
          docs: {
            files: ["readme.md"],
            subFolders: {
              notes: {
                files: ["note1.md", "note2.md", "image.png"],
                extensionCounts: { md: 2, png: 1 },
              },
            },
            extensionCounts: { md: 3, png: 1 },
          },
        },
        extensionCounts: { md: 4, png: 1, json: 1, unknown: 1 },
      },
    };

    expect(tree).toEqual(expectedTree);
  });

  it("should handle empty folders after filtering", async () => {
    // Mock shouldIndexFile to exclude all files
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(false);

    // Test buildFileTree with all files excluded
    const tree = buildFileTree(root);

    const expectedTree = {};

    expect(tree).toEqual(expectedTree);
  });
});
