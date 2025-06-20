import * as Obsidian from "obsidian";
import { TFile } from "obsidian";
import {
  extractNoteFiles,
  getNotesFromPath,
  getNotesFromTags,
  isFolderMatch,
  processVariableNameForNotePath,
  removeThinkTags,
} from "./utils";

// Mock Obsidian's TFile class
jest.mock("obsidian", () => {
  class MockTFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string = "") {
      this.path = path;
      const parts = path.split("/");
      const filename = parts[parts.length - 1];
      this.basename = filename.replace(/\.[^/.]+$/, "");
      this.extension = filename.split(".").pop() || "";
    }
  }

  class MockVault {
    private files: MockTFile[];

    constructor() {
      this.files = [
        new MockTFile("test/test2/note1.md"),
        new MockTFile("test/note2.md"),
        new MockTFile("test2/note3.md"),
        new MockTFile("note4.md"),
        new MockTFile("Note1.md"),
        new MockTFile("Note2.md"),
        new MockTFile("Note 1.md"),
        new MockTFile("Another Note.md"),
        new MockTFile("Note-1.md"),
        new MockTFile("Note_2.md"),
        new MockTFile("Note#3.md"),
      ];
    }

    getMarkdownFiles() {
      return this.files;
    }

    getAbstractFileByPath(path: string) {
      const file = this.files.find((f) => f.path === path + (path.endsWith(".md") ? "" : ".md"));
      return file || null;
    }
  }

  return {
    TFile: MockTFile,
    Vault: MockVault,
  };
});

// Mock the metadata cache
const mockMetadataCache = {
  getFileCache: jest.fn(),
};

// Mock file metadata for different test cases
const mockFileMetadata = {
  "test/test2/note1.md": {
    tags: [{ tag: "#inlineTag1" }, { tag: "#inlineTag2" }],
    frontmatter: { tags: ["tag1", "tag2", "tag4"] },
  },
  "test/note2.md": {
    tags: [{ tag: "#inlineTag3" }, { tag: "#inlineTag4" }],
    frontmatter: { tags: ["tag2", "tag3"] },
  },
  "test2/note3.md": {
    tags: [{ tag: "#inlineTag5" }],
    frontmatter: { tags: ["tag5"] },
  },
  "note4.md": {
    tags: [{ tag: "#inlineTag1" }, { tag: "#inlineTag6" }],
    frontmatter: { tags: ["tag1", "tag4"] },
  },
};

// Mock the global app object
const mockApp = {
  vault: new Obsidian.Vault(),
  metadataCache: mockMetadataCache,
} as any;

describe("isFolderMatch", () => {
  it("should return file from the folder name 1", async () => {
    const match = isFolderMatch("test2/note3.md", "test2");
    expect(match).toEqual(true);
  });

  it("should return file from the folder name 2", async () => {
    const match = isFolderMatch("test/test2/note1.md", "test2");
    expect(match).toEqual(true);
  });

  it("should return file from the folder name 3", async () => {
    const match = isFolderMatch("test/test2/note1.md", "test");
    expect(match).toEqual(true);
  });

  it("should not return file from the folder name 1", async () => {
    const match = isFolderMatch("test/test2/note1.md", "tes");
    expect(match).toEqual(false);
  });

  it("should return file from file name 1", async () => {
    const match = isFolderMatch("test/test2/note1.md", "note1.md");
    expect(match).toEqual(true);
  });
});

describe("Vault", () => {
  it("should return all markdown files", async () => {
    const vault = new Obsidian.Vault();
    const files = vault.getMarkdownFiles();
    expect(files.map((f) => f.path)).toEqual([
      "test/test2/note1.md",
      "test/note2.md",
      "test2/note3.md",
      "note4.md",
      "Note1.md",
      "Note2.md",
      "Note 1.md",
      "Another Note.md",
      "Note-1.md",
      "Note_2.md",
      "Note#3.md",
    ]);
  });
});

describe("getNotesFromPath", () => {
  it("should return all markdown files", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "/");
    expect(files.map((f) => f.path)).toEqual([
      "test/test2/note1.md",
      "test/note2.md",
      "test2/note3.md",
      "note4.md",
      "Note1.md",
      "Note2.md",
      "Note 1.md",
      "Another Note.md",
      "Note-1.md",
      "Note_2.md",
      "Note#3.md",
    ]);
  });

  it("should return filtered markdown files 1", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "test2");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test2/note3.md"]);
  });

  it("should return filtered markdown files 2", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "test");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test/note2.md"]);
  });

  it("should return filtered markdown files 3", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "note4.md");
    expect(files.map((f) => f.path)).toEqual(["note4.md"]);
  });

  it("should return filtered markdown files 4", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "/test");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test/note2.md"]);
  });

  it("should not return markdown files", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "");
    expect(files).toEqual([]);
  });

  it("should return only files from the specified subfolder path", async () => {
    const vault = new Obsidian.Vault();
    // Mock the getMarkdownFiles method to return our test structure
    vault.getMarkdownFiles = jest
      .fn()
      .mockReturnValue([
        { path: "folder/subfolder 1/eng/1.md" },
        { path: "folder/subfolder 2/eng/3.md" },
        { path: "folder/subfolder 1/eng/2.md" },
        { path: "folder/other/note.md" },
      ]);

    const files = await getNotesFromPath(vault, "folder/subfolder 1/eng");
    expect(files).toEqual([
      { path: "folder/subfolder 1/eng/1.md" },
      { path: "folder/subfolder 1/eng/2.md" },
    ]);
  });

  describe("processVariableNameForNotePath", () => {
    it("should return the note md filename", () => {
      const variableName = processVariableNameForNotePath("[[test]]");
      expect(variableName).toEqual("test.md");
    });

    it("should return the note md filename with extra spaces 1", () => {
      const variableName = processVariableNameForNotePath(" [[  test]]");
      expect(variableName).toEqual("test.md");
    });

    it("should return the note md filename with extra spaces 2", () => {
      const variableName = processVariableNameForNotePath("[[ test   ]] ");
      expect(variableName).toEqual("test.md");
    });

    it("should return the note md filename with extra spaces 2", () => {
      const variableName = processVariableNameForNotePath(" [[ test note   ]] ");
      expect(variableName).toEqual("test note.md");
    });

    it("should return the note md filename with extra spaces 2", () => {
      const variableName = processVariableNameForNotePath(" [[    test_note note   ]] ");
      expect(variableName).toEqual("test_note note.md");
    });

    it("should return folder path with leading slash", () => {
      const variableName = processVariableNameForNotePath("/testfolder");
      expect(variableName).toEqual("/testfolder");
    });

    it("should return folder path without slash", () => {
      const variableName = processVariableNameForNotePath("testfolder");
      expect(variableName).toEqual("testfolder");
    });

    it("should return folder path with trailing slash", () => {
      const variableName = processVariableNameForNotePath("testfolder/");
      expect(variableName).toEqual("testfolder/");
    });

    it("should return folder path with leading spaces", () => {
      const variableName = processVariableNameForNotePath("  testfolder ");
      expect(variableName).toEqual("testfolder");
    });
  });
});

describe("getNotesFromTags", () => {
  beforeAll(() => {
    // @ts-ignore
    global.app = mockApp;

    // Setup metadata cache mock
    mockMetadataCache.getFileCache.mockImplementation((file: TFile) => {
      return mockFileMetadata[file.path as keyof typeof mockFileMetadata];
    });
  });

  afterAll(() => {
    // @ts-ignore
    delete global.app;
  });

  beforeEach(() => {
    mockMetadataCache.getFileCache.mockClear();
  });

  it("should return files with specified tags 1", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag1"];
    const expectedPaths = ["test/test2/note1.md", "note4.md"];

    const result = await getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should return an empty array if no files match the specified nonexistent tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#nonexistentTag"];
    const expected: string[] = [];

    const result = await getNotesFromTags(mockVault, tags);

    expect(result).toEqual(expected);
  });

  it("should handle multiple tags, returning files that match any of them", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag2", "#tag4"];
    const expectedPaths = ["test/test2/note1.md", "test/note2.md", "note4.md"];

    const result = await getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should handle both path and tags, returning files under the specified path with the specified tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag1"];
    const noteFiles = [{ path: "test/test2/note1.md" }, { path: "test/note2.md" }] as TFile[];
    const expectedPaths = ["test/test2/note1.md"];

    const result = await getNotesFromTags(mockVault, tags, noteFiles);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should ignore inline tags and only consider frontmatter tags", async () => {
    const mockVault = new Obsidian.Vault();

    const tags = ["#inlineTag1"];
    const result = await getNotesFromTags(mockVault, tags);

    expect(result).toEqual([]); // Should return empty since inline tags are ignored
  });
});

describe("extractNoteFiles", () => {
  let mockVault: Obsidian.Vault;

  beforeEach(() => {
    mockVault = new Obsidian.Vault();
  });

  it("should extract single note title", () => {
    const query = "Please refer to [[Note1]] for more information.";
    const result = extractNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md"]);
  });

  it("should extract multiple note titles", () => {
    const query = "Please refer to [[Note1]] and [[Note2]] for more information.";
    const result = extractNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md", "Note2.md"]);
  });

  it("should handle note titles with spaces", () => {
    const query = "Check out [[Note 1]] and [[Another Note]] for details.";
    const result = extractNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note 1.md", "Another Note.md"]);
  });

  it("should handle duplicate note titles", () => {
    const query = "Refer to [[Note1]], [[Note2]], and [[Note1]] again.";
    const result = extractNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md", "Note2.md"]);
  });

  it("should return empty array when no note titles found", () => {
    const query = "There are no note titles in this string.";
    const result = extractNoteFiles(query, mockVault);
    expect(result).toEqual([]);
  });

  it("should handle note titles with special characters", () => {
    const query = "Important notes: [[Note-1]], [[Note_2]], and [[Note#3]].";
    const result = extractNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note-1.md", "Note_2.md", "Note#3.md"]);
  });
});

describe("removeThinkTags", () => {
  it("should remove complete think tags and their content", () => {
    const input = "Before <think>This is thinking content</think> After";
    const expected = "Before  After";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle multiple think tags", () => {
    const input = "Text <think>First thought</think> middle <think>Second thought</think> end";
    const expected = "Text  middle  end";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle multiline think content", () => {
    const input = `Start
<think>
Line 1
Line 2
Line 3
</think>
End`;
    const expected = "Start\n\nEnd";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle unclosed think tags (streaming scenario)", () => {
    const input = "Before content <think>Partial thought that is still being";
    const expected = "Before content";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle empty think tags", () => {
    const input = "Text <think></think> more text";
    const expected = "Text  more text";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle text without think tags", () => {
    const input = "This is regular text without any think tags";
    const expected = "This is regular text without any think tags";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle nested content within think tags", () => {
    const input = `Main text <think>
I need to consider:
- Point 1
- Point 2
<inner>nested content</inner>
</think> Final text`;
    const expected = "Main text  Final text";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should trim whitespace from the result", () => {
    const input = "  <think>content</think>  ";
    const expected = "";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle think tags at the beginning of text", () => {
    const input = "<think>Initial thoughts</think>Main content here";
    const expected = "Main content here";
    expect(removeThinkTags(input)).toBe(expected);
  });

  it("should handle think tags at the end of text", () => {
    const input = "Main content here<think>Final thoughts</think>";
    const expected = "Main content here";
    expect(removeThinkTags(input)).toBe(expected);
  });
});
