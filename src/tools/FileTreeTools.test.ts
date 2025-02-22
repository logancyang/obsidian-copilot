import { TFolder } from "obsidian";
import { createGetFileTreeTool } from "./FileTreeTools";
import * as searchUtils from "@/search/searchUtils";

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
    ];

    notes.children = [
      new MockTFile("docs/notes/note1.md", notes),
      new MockTFile("docs/notes/note2.md", notes),
    ];

    root.children = [docs, new MockTFile("readme.md", root)];

    // Reset mocks before each test
    jest.clearAllMocks();

    // Default mock implementations
    (searchUtils.getMatchingPatterns as jest.Mock).mockReturnValue({
      inclusions: null,
      exclusions: null,
    });
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(true);
  });

  it("should generate correct JSON file tree when no exclusions", async () => {
    const tool = createGetFileTreeTool(root);
    const result = await tool.invoke({});
    // Extract JSON part after the prompt
    const jsonPart = result.substring(result.indexOf("{"));
    const parsedResult = JSON.parse(jsonPart);

    expect(searchUtils.getMatchingPatterns).toHaveBeenCalled();
    expect(searchUtils.shouldIndexFile).toHaveBeenCalled();

    const expected = {
      vault: [
        ["readme.md"],
        {
          docs: [
            ["readme.md"],
            {
              projects: ["project1.md", "project2.md"],
              notes: ["note1.md", "note2.md"],
            },
          ],
        },
      ],
    };

    expect(parsedResult).toEqual(expected);
  });

  it("should exclude files based on patterns", async () => {
    // Mock shouldIndexFile to exclude all files in projects folder
    (searchUtils.shouldIndexFile as jest.Mock).mockImplementation((file) => {
      return !file.path.includes("projects");
    });

    const tool = createGetFileTreeTool(root);
    const result = await tool.invoke({});
    const jsonPart = result.substring(result.indexOf("{"));
    const parsedResult = JSON.parse(jsonPart);

    const expected = {
      vault: [
        ["readme.md"],
        {
          docs: [
            ["readme.md"],
            {
              notes: ["note1.md", "note2.md"],
            },
          ],
        },
      ],
    };

    expect(parsedResult).toEqual(expected);
  });

  it("should handle empty folder after exclusions", async () => {
    // Mock shouldIndexFile to exclude all files
    (searchUtils.shouldIndexFile as jest.Mock).mockReturnValue(false);

    const tool = createGetFileTreeTool(root);
    const result = await tool.invoke({});
    const jsonPart = result.substring(result.indexOf("{"));
    const parsedResult = JSON.parse(jsonPart);

    expect(parsedResult).toEqual({});
  });

  it("should handle partial folder exclusions", async () => {
    // Mock shouldIndexFile to only include files with "note" in the path
    (searchUtils.shouldIndexFile as jest.Mock).mockImplementation((file) => {
      return file.path.includes("note");
    });

    const tool = createGetFileTreeTool(root);
    const result = await tool.invoke({});
    const jsonPart = result.substring(result.indexOf("{"));
    const parsedResult = JSON.parse(jsonPart);

    const expected = {
      vault: {
        docs: {
          notes: ["note1.md", "note2.md"],
        },
      },
    };

    expect(parsedResult).toEqual(expected);
  });
});
