import { TFolder } from "obsidian";
import { createGetFileTreeTool } from "./FileTreeTools";

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

    root.children = [docs];
  });

  it("should generate correct JSON file tree representation", async () => {
    const tool = createGetFileTreeTool(root);
    const result = await tool.invoke({});
    const parsedResult = JSON.parse(result);

    const expected = {
      type: "folder",
      path: "",
      children: [
        {
          type: "folder",
          path: "docs",
          children: [
            {
              type: "folder",
              path: "docs/projects",
              children: [
                { type: "file", path: "docs/projects/project1.md" },
                { type: "file", path: "docs/projects/project2.md" },
              ],
            },
            {
              type: "folder",
              path: "docs/notes",
              children: [
                { type: "file", path: "docs/notes/note1.md" },
                { type: "file", path: "docs/notes/note2.md" },
              ],
            },
            { type: "file", path: "docs/readme.md" },
          ],
        },
      ],
    };

    expect(parsedResult).toEqual(expected);
  });

  it("should handle empty folder", async () => {
    const emptyRoot = new MockTFolder("", null);
    const tool = createGetFileTreeTool(emptyRoot);
    const result = await tool.invoke({});
    const parsedResult = JSON.parse(result);

    const expected = {
      type: "folder",
      path: "",
      children: [],
    };

    expect(parsedResult).toEqual(expected);
  });
});
