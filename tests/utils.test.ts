import * as Obsidian from "obsidian";
import { TFile } from "obsidian";
import {
  extractNoteTitles,
  getNotesFromPath,
  getNotesFromTags,
  isFolderMatch,
  isPathInList,
  processVariableNameForNotePath,
} from "../src/utils";

// Mock Obsidian's TFile class
jest.mock("obsidian", () => ({
  TFile: class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string) {
      this.path = path;
      const parts = path.split("/");
      const filename = parts[parts.length - 1];
      this.basename = filename.replace(/\.[^/.]+$/, "");
      this.extension = filename.split(".").pop() || "";
    }
  },
  Vault: class Vault {
    getMarkdownFiles() {
      return [
        { path: "test/test2/note1.md" },
        { path: "test/note2.md" },
        { path: "test2/note3.md" },
        { path: "note4.md" },
      ];
    }
  },
}));

// Mock the metadata cache
const mockMetadataCache = {
  getFileCache: jest.fn(),
};

// Mock file metadata for different test cases
const mockFileMetadata = {
  "test/test2/note1.md": {
    tags: [{ tag: "#tag1" }, { tag: "#tag2" }],
    frontmatter: { tags: ["tag4"] },
  },
  "test/note2.md": {
    tags: [{ tag: "#tag2" }, { tag: "#tag3" }],
  },
  "test2/note3.md": {
    frontmatter: { tags: "tag5" },
  },
  "note4.md": {
    tags: [{ tag: "#tag1" }, { tag: "#tag4" }],
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
    expect(files).toEqual([
      { path: "test/test2/note1.md" },
      { path: "test/note2.md" },
      { path: "test2/note3.md" },
      { path: "note4.md" },
    ]);
  });
});

describe("getNotesFromPath", () => {
  it("should return all markdown files", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "/");
    expect(files).toEqual([
      { path: "test/test2/note1.md" },
      { path: "test/note2.md" },
      { path: "test2/note3.md" },
      { path: "note4.md" },
    ]);
  });

  it("should return filtered markdown files 1", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "test2");
    expect(files).toEqual([{ path: "test/test2/note1.md" }, { path: "test2/note3.md" }]);
  });

  it("should return filtered markdown files 2", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "test");
    expect(files).toEqual([{ path: "test/test2/note1.md" }, { path: "test/note2.md" }]);
  });

  it("should return filtered markdown files 3", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "note4.md");
    expect(files).toEqual([{ path: "note4.md" }]);
  });

  it("should return filtered markdown files 4", async () => {
    const vault = new Obsidian.Vault();
    const files = await getNotesFromPath(vault, "/test");
    expect(files).toEqual([{ path: "test/test2/note1.md" }, { path: "test/note2.md" }]);
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
    const tags = ["tag1"];
    const expectedPaths = ["test/test2/note1.md", "note4.md"];

    const result = await getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should return files with specified tags 2", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag3"];
    const expectedPaths = ["test/note2.md"];

    const result = await getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should return an empty array if no files match the specified nonexistent tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["nonexistentTag"];
    const expected: string[] = [];

    const result = await getNotesFromTags(mockVault, tags);

    expect(result).toEqual(expected);
  });

  it("should handle multiple tags, returning files that match any of them", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["tag2", "tag4"]; // Files that include 'tag2' or 'tag4'
    const expectedPaths = ["test/test2/note1.md", "test/note2.md", "note4.md"];

    const result = await getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should handle both path and tags, returning files under the specified path with the specified tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["tag1"];
    const noteFiles = [{ path: "test/test2/note1.md" }, { path: "test/note2.md" }] as TFile[];
    const expectedPaths = ["test/test2/note1.md"];

    const result = await getNotesFromTags(mockVault, tags, noteFiles);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });
});

describe("isPathInList", () => {
  it("should exclude a file path that exactly matches an excluded path", () => {
    const result = isPathInList("test/folder/note.md", "test/folder");
    expect(result).toBe(true);
  });

  it("should not exclude a file path if there is no match", () => {
    const result = isPathInList("test/folder/note.md", "another/folder");
    expect(result).toBe(false);
  });

  it("should exclude a file path that matches an excluded path with leading slash", () => {
    const result = isPathInList("test/folder/note.md", "/test/folder");
    expect(result).toBe(true);
  });

  it("should exclude a note title that matches an excluded path with surrounding [[ and ]]", () => {
    const result = isPathInList("test/folder/note1.md", "[[note1]]");
    expect(result).toBe(true);
  });

  it("should be case insensitive when excluding a file path", () => {
    const result = isPathInList("Test/Folder/Note.md", "test/folder");
    expect(result).toBe(true);
  });

  it("should handle multiple excluded paths separated by commas", () => {
    const result = isPathInList("test/folder/note.md", "another/folder,test/folder");
    expect(result).toBe(true);
  });

  it("should not exclude a file path if it partially matches an excluded path without proper segmentation", () => {
    const result = isPathInList("test/folder123/note.md", "test/folder");
    expect(result).toBe(false);
  });

  it("should exclude a file path that matches any one of multiple excluded paths", () => {
    const result = isPathInList(
      "test/folder/note.md",
      "another/folder, test/folder, yet/another/folder"
    );
    expect(result).toBe(true);
  });

  it("should trim spaces around excluded paths", () => {
    const result = isPathInList("test/folder/note.md", " another/folder , test/folder ");
    expect(result).toBe(true);
  });
});

describe("extractNoteTitles", () => {
  it("should extract single note title", () => {
    const query = "Please refer to [[Note1]] for more information.";
    const expected = ["Note1"];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });

  it("should extract multiple note titles", () => {
    const query = "Please refer to [[Note1]] and [[Note2]] for more information.";
    const expected = ["Note1", "Note2"];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });

  it("should handle note titles with spaces", () => {
    const query = "Check out [[Note 1]] and [[Another Note]] for details.";
    const expected = ["Note 1", "Another Note"];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });

  it("should ignore duplicates and return unique titles", () => {
    const query = "Refer to [[Note1]], [[Note2]], and [[Note1]] again.";
    const expected = ["Note1", "Note2"];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });

  it("should return an empty array if no note titles are found", () => {
    const query = "There are no note titles in this string.";
    const expected: string[] = [];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });

  it("should extract note titles with special characters", () => {
    const query = "Important notes: [[Note-1]], [[Note_2]], and [[Note#3]].";
    const expected = ["Note-1", "Note_2", "Note#3"];
    const result = extractNoteTitles(query);
    expect(result).toEqual(expected);
  });
});
