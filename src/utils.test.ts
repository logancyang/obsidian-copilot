import * as Obsidian from "obsidian";
import { TFile } from "obsidian";
import {
  extractNoteFiles,
  extractTemplateNoteFiles,
  formatDateTime,
  getModelInfo,
  getNotesFromPath,
  getNotesFromTags,
  getUtf8ByteLength,
  isFolderMatch,
  shouldUseGitHubCopilotResponsesApi,
  processVariableNameForNotePath,
  removeThinkTags,
  stringToFormattedDateTime,
  stripFrontmatter,
  truncateToByteLimit,
  withTimeout,
} from "./utils";
import { TimeoutError } from "./error";
import { ChatModelProviders } from "./constants";

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
} as unknown as typeof window.app;

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
    const files = getNotesFromPath(vault, "/");
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
    const files = getNotesFromPath(vault, "test2");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test2/note3.md"]);
  });

  it("should return filtered markdown files 2", async () => {
    const vault = new Obsidian.Vault();
    const files = getNotesFromPath(vault, "test");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test/note2.md"]);
  });

  it("should return filtered markdown files 3", async () => {
    const vault = new Obsidian.Vault();
    const files = getNotesFromPath(vault, "note4.md");
    expect(files.map((f) => f.path)).toEqual(["note4.md"]);
  });

  it("should return filtered markdown files 4", async () => {
    const vault = new Obsidian.Vault();
    const files = getNotesFromPath(vault, "/test");
    expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test/note2.md"]);
  });

  it("should not return markdown files", async () => {
    const vault = new Obsidian.Vault();
    const files = getNotesFromPath(vault, "");
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

    const files = getNotesFromPath(vault, "folder/subfolder 1/eng");
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
    window.app = mockApp;

    // Setup metadata cache mock
    mockMetadataCache.getFileCache.mockImplementation((file: TFile) => {
      return mockFileMetadata[file.path as keyof typeof mockFileMetadata];
    });
  });

  afterAll(() => {
    // @ts-ignore
    delete window.app;
  });

  beforeEach(() => {
    mockMetadataCache.getFileCache.mockClear();
  });

  it("should return files with specified tags 1", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag1"];
    const expectedPaths = ["test/test2/note1.md", "note4.md"];

    const result = getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should return an empty array if no files match the specified nonexistent tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#nonexistentTag"];
    const expected: string[] = [];

    const result = getNotesFromTags(mockVault, tags);

    expect(result).toEqual(expected);
  });

  it("should handle multiple tags, returning files that match any of them", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag2", "#tag4"];
    const expectedPaths = ["test/test2/note1.md", "test/note2.md", "note4.md"];

    const result = getNotesFromTags(mockVault, tags);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should handle both path and tags, returning files under the specified path with the specified tags", async () => {
    const mockVault = new Obsidian.Vault();
    const tags = ["#tag1"];
    type TFileCtor = new (path: string) => TFile;
    const noteFiles: TFile[] = [
      new (TFile as unknown as TFileCtor)("test/test2/note1.md"),
      new (TFile as unknown as TFileCtor)("test/note2.md"),
    ];
    const expectedPaths = ["test/test2/note1.md"];

    const result = getNotesFromTags(mockVault, tags, noteFiles);
    const resultPaths = result.map((fileWithTags) => fileWithTags.path);

    expect(resultPaths).toEqual(expect.arrayContaining(expectedPaths));
    expect(resultPaths.length).toEqual(expectedPaths.length);
  });

  it("should ignore inline tags and only consider frontmatter tags", async () => {
    const mockVault = new Obsidian.Vault();

    const tags = ["#inlineTag1"];
    const result = getNotesFromTags(mockVault, tags);

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

describe("extractTemplateNoteFiles", () => {
  let mockVault: Obsidian.Vault;

  beforeEach(() => {
    mockVault = new Obsidian.Vault();
  });

  it("should extract single note title wrapped in curly braces", () => {
    const query = "Please refer to {[[Note1]]} for more information.";
    const result = extractTemplateNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md"]);
  });

  it("should extract multiple note titles wrapped in curly braces", () => {
    const query = "Please refer to {[[Note1]]} and {[[Note2]]} for more information.";
    const result = extractTemplateNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md", "Note2.md"]);
  });

  it("should handle note titles with spaces", () => {
    const query = "Check out {[[Note 1]]} and {[[Another Note]]} for details.";
    const result = extractTemplateNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note 1.md", "Another Note.md"]);
  });

  it("should handle duplicate note titles", () => {
    const query = "Refer to {[[Note1]]}, {[[Note2]]}, and {[[Note1]]} again.";
    const result = extractTemplateNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md", "Note2.md"]);
  });

  it("should NOT extract bare wikilinks without curly braces", () => {
    const query = "This [[Note1]] should not be extracted.";
    const result = extractTemplateNoteFiles(query, mockVault);
    expect(result).toEqual([]);
  });

  it("should only extract wikilinks with curly braces, ignoring bare ones", () => {
    const query = "Extract {[[Note1]]} but not [[Note2]].";
    const result = extractTemplateNoteFiles(query, mockVault);
    const resultPaths = result.map((f) => f.path);
    expect(resultPaths).toEqual(["Note1.md"]);
  });

  it("should return empty array when no {[[...]]} patterns found", () => {
    const query = "There are no template note patterns in this string.";
    const result = extractTemplateNoteFiles(query, mockVault);
    expect(result).toEqual([]);
  });

  it("should return empty array when only bare [[...]] patterns exist", () => {
    const query = "Only [[Note1]] and [[Note2]] exist here.";
    const result = extractTemplateNoteFiles(query, mockVault);
    expect(result).toEqual([]);
  });

  it("should handle note titles with special characters", () => {
    const query = "Important notes: {[[Note-1]]}, {[[Note_2]]}, and {[[Note#3]]}.";
    const result = extractTemplateNoteFiles(query, mockVault);
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

describe("shouldUseGitHubCopilotResponsesApi", () => {
  it("should enable responses API for GitHub Copilot codex models", () => {
    expect(
      shouldUseGitHubCopilotResponsesApi({
        provider: ChatModelProviders.GITHUB_COPILOT,
        name: "gpt-5.3-codex",
      })
    ).toBe(true);
  });

  it("should not enable responses API for non-codex GitHub Copilot models by default", () => {
    expect(
      shouldUseGitHubCopilotResponsesApi({
        provider: ChatModelProviders.GITHUB_COPILOT,
        name: "gpt-4.1",
      })
    ).toBe(false);
  });

  it("should ignore codex names for non-Copilot providers", () => {
    expect(
      shouldUseGitHubCopilotResponsesApi({
        provider: ChatModelProviders.OPENAI,
        name: "gpt-5.3-codex",
      })
    ).toBe(false);
  });

  it("should allow explicit responses API opt-in for GitHub Copilot models", () => {
    expect(
      shouldUseGitHubCopilotResponsesApi({
        provider: ChatModelProviders.GITHUB_COPILOT,
        name: "custom-model",
        useResponsesApi: true,
      })
    ).toBe(true);
  });
});

describe("withTimeout", () => {
  it("should return result when operation completes within timeout", async () => {
    const operation = async (signal: AbortSignal) => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      return "success";
    };

    const result = await withTimeout(operation, 200, "Test operation");
    expect(result).toBe("success");
  });

  it("should throw TimeoutError when operation exceeds timeout", async () => {
    const operation = async (signal: AbortSignal) => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      return "should not complete";
    };

    await expect(withTimeout(operation, 50, "Test operation")).rejects.toThrow(TimeoutError);

    await expect(withTimeout(operation, 50, "Test operation")).rejects.toThrow(
      "Test operation timed out after 50ms"
    );
  });

  it("should abort the operation when timeout is reached", async () => {
    let wasAborted = false;
    const operation = async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => {
        wasAborted = true;
      });

      await new Promise((resolve) => window.setTimeout(resolve, 200));
      return "should not complete";
    };

    try {
      await withTimeout(operation, 50, "Test operation");
    } catch {
      // Expected to timeout
    }

    // Give time for abort event to fire
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(wasAborted).toBe(true);
  });

  it("should handle operation that throws non-timeout errors", async () => {
    const operation = async (signal: AbortSignal) => {
      throw new Error("Operation failed");
    };

    await expect(withTimeout(operation, 200, "Test operation")).rejects.toThrow("Operation failed");
  });

  it("should clean up timeout even when operation throws", async () => {
    const operation = async (signal: AbortSignal) => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      throw new Error("Operation failed");
    };

    await expect(withTimeout(operation, 200, "Test operation")).rejects.toThrow("Operation failed");

    // If timeout cleanup failed, this would log warnings about unhandled timeouts
    // The fact that this test passes cleanly indicates proper cleanup
  });
});

describe("TimeoutError", () => {
  it("should create error with correct message and name", () => {
    const error = new TimeoutError("Test operation", 5000);

    expect(error.message).toBe("Test operation timed out after 5000ms");
    expect(error.name).toBe("TimeoutError");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TimeoutError);
  });
});

describe("getUtf8ByteLength", () => {
  it("should correctly calculate byte length for ASCII text", () => {
    expect(getUtf8ByteLength("Hello")).toBe(5);
    expect(getUtf8ByteLength("Test 123")).toBe(8);
  });

  it("should correctly calculate byte length for Cyrillic text", () => {
    // Each Cyrillic character is 2 bytes in UTF-8
    expect(getUtf8ByteLength("Привет")).toBe(12); // 6 chars × 2 bytes
    expect(getUtf8ByteLength("мир")).toBe(6); // 3 chars × 2 bytes
  });

  it("should correctly calculate byte length for Chinese/Japanese/Korean text", () => {
    // CJK characters are typically 3 bytes in UTF-8
    expect(getUtf8ByteLength("你好")).toBe(6); // 2 chars × 3 bytes
    expect(getUtf8ByteLength("こんにちは")).toBe(15); // 5 chars × 3 bytes
    expect(getUtf8ByteLength("안녕")).toBe(6); // 2 chars × 3 bytes
  });

  it("should correctly calculate byte length for emoji", () => {
    // Emoji are typically 4 bytes in UTF-8
    expect(getUtf8ByteLength("🚀")).toBe(4);
    expect(getUtf8ByteLength("🌟")).toBe(4);
    expect(getUtf8ByteLength("🚀🌟")).toBe(8);
  });

  it("should correctly calculate byte length for mixed text", () => {
    expect(getUtf8ByteLength("Hello мир 你好")).toBe(19); // 5 + 1 + 6 + 1 + 6 = 19
  });

  it("should handle empty string", () => {
    expect(getUtf8ByteLength("")).toBe(0);
  });
});

describe("truncateToByteLimit", () => {
  it("should return string as-is if within byte limit", () => {
    expect(truncateToByteLimit("Hello", 10)).toBe("Hello");
    expect(truncateToByteLimit("Test", 4)).toBe("Test");
  });

  it("should truncate ASCII text to byte limit", () => {
    expect(truncateToByteLimit("Hello World", 5)).toBe("Hello");
    expect(truncateToByteLimit("Test123456", 7)).toBe("Test123");
  });

  it("should truncate Cyrillic text without breaking characters", () => {
    const cyrillic = "Привет мир";
    // "Привет" = 12 bytes, " " = 1 byte, "мир" = 6 bytes
    // Total = 19 bytes
    const result = truncateToByteLimit(cyrillic, 13);
    // Should include "Привет " (13 bytes) or "Привет" (12 bytes) depending on space handling
    expect(getUtf8ByteLength(result)).toBeLessThanOrEqual(13);
    // Verify no broken characters (each result should be valid UTF-8)
    expect(result.length).toBeGreaterThan(0);
  });

  it("should truncate emoji without breaking characters", () => {
    const emoji = "🚀🌟✨🎉";
    // Each emoji is 4 bytes, total = 16 bytes
    const result = truncateToByteLimit(emoji, 8);
    // Should include exactly 2 emoji (8 bytes)
    expect(getUtf8ByteLength(result)).toBeLessThanOrEqual(8);
    expect(result).toBe("🚀🌟");
  });

  it("should handle mixed Unicode text", () => {
    const mixed = "Hello мир 你好";
    // "Hello" = 5, " " = 1, "мир" = 6, " " = 1, "你好" = 6
    // Total = 19 bytes
    const result = truncateToByteLimit(mixed, 12);
    expect(getUtf8ByteLength(result)).toBeLessThanOrEqual(12);
    // Should include at least "Hello мир" (12 bytes)
    expect(result).toContain("Hello");
  });

  it("should return empty string for byte limit of 0", () => {
    expect(truncateToByteLimit("Hello", 0)).toBe("");
  });

  it("should return empty string for negative byte limit", () => {
    expect(truncateToByteLimit("Hello", -1)).toBe("");
  });

  it("should handle empty string", () => {
    expect(truncateToByteLimit("", 10)).toBe("");
  });

  it("should handle very long Cyrillic text", () => {
    const longCyrillic =
      "используй словарь уже установленных терминов Словарь перевода Songs of Syx";
    const result = truncateToByteLimit(longCyrillic, 50);
    expect(getUtf8ByteLength(result)).toBeLessThanOrEqual(50);
    // Should not break in the middle of a character
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle edge case where single character exceeds limit", () => {
    // If a single emoji (4 bytes) exceeds the limit of 3 bytes
    const result = truncateToByteLimit("🚀Test", 3);
    // Binary search may find a partial character, but we can't include it
    // The function should return an empty string or the longest valid prefix
    expect(getUtf8ByteLength(result)).toBeLessThanOrEqual(3);
  });
});

describe("stripFrontmatter", () => {
  it("should strip YAML frontmatter from content", () => {
    const content = `---
title: Test
date: 2024-01-01
---
This is the actual content.`;
    const result = stripFrontmatter(content);
    expect(result).toBe("This is the actual content.");
  });

  it("should return content unchanged if no frontmatter", () => {
    const content = "This is content without frontmatter.";
    const result = stripFrontmatter(content);
    expect(result).toBe("This is content without frontmatter.");
  });

  it("should handle content that starts with --- but has no closing ---", () => {
    const content = "---\nThis is not valid frontmatter";
    const result = stripFrontmatter(content);
    expect(result).toBe("---\nThis is not valid frontmatter");
  });

  it("should handle empty content", () => {
    const result = stripFrontmatter("");
    expect(result).toBe("");
  });

  it("should handle content with --- in the middle", () => {
    const content = `---
title: Test
---
Content with --- separator in the middle.`;
    const result = stripFrontmatter(content);
    expect(result).toBe("Content with --- separator in the middle.");
  });

  it("should trim leading whitespace after frontmatter", () => {
    const content = `---
title: Test
---

  Content with leading whitespace after frontmatter.`;
    const result = stripFrontmatter(content);
    // trimStart removes the newlines and spaces
    expect(result).toBe("Content with leading whitespace after frontmatter.");
  });

  it("should handle frontmatter with various field types", () => {
    const content = `---
title: "Quoted String"
count: 42
enabled: true
tags:
  - tag1
  - tag2
---
Body content here.`;
    const result = stripFrontmatter(content);
    expect(result).toBe("Body content here.");
  });

  it("should preserve leading whitespace after frontmatter when trimStart is false", () => {
    const content = `---
title: Test
---
  Content with leading whitespace after frontmatter.`;
    const result = stripFrontmatter(content, { trimStart: false });
    expect(result).toBe("  Content with leading whitespace after frontmatter.");
  });

  it("should preserve multiple leading newlines when trimStart is false", () => {
    const content = `---
title: Test
---

  Content after empty line.`;
    const result = stripFrontmatter(content, { trimStart: false });
    expect(result).toBe("\n  Content after empty line.");
  });

  it("should handle CRLF line endings when trimStart is false", () => {
    const content = "---\r\ntitle: Test\r\n---\r\n  Content here.";
    const result = stripFrontmatter(content, { trimStart: false });
    expect(result).toBe("  Content here.");
  });
});

describe("formatDateTime", () => {
  const fixedDate = new Date("2024-03-15T14:30:45.123Z");

  it("formats UTC deterministically when timezone='utc'", () => {
    const result = formatDateTime(fixedDate, "utc");
    expect(result.fileName).toBe("20240315_143045");
    expect(result.display).toBe("2024/03/15 14:30:45");
    expect(result.epoch).toBe(fixedDate.getTime());
  });

  it("local format is structurally valid and matches host timezone offset", () => {
    const result = formatDateTime(fixedDate, "local");
    // Display must always be "YYYY/MM/DD HH:mm:ss" regardless of host TZ.
    expect(result.display).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result.fileName).toMatch(/^\d{8}_\d{6}$/);
    expect(result.epoch).toBe(fixedDate.getTime());

    // The local display should equal what the host JS Date renders.
    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedDisplay =
      `${fixedDate.getFullYear()}/${pad(fixedDate.getMonth() + 1)}/${pad(fixedDate.getDate())} ` +
      `${pad(fixedDate.getHours())}:${pad(fixedDate.getMinutes())}:${pad(fixedDate.getSeconds())}`;
    expect(result.display).toBe(expectedDisplay);
  });

  it("local and UTC differ when host is not on UTC, and agree otherwise", () => {
    const local = formatDateTime(fixedDate, "local");
    const utc = formatDateTime(fixedDate, "utc");
    if (fixedDate.getTimezoneOffset() === 0) {
      expect(local.display).toBe(utc.display);
    } else {
      expect(local.display).not.toBe(utc.display);
    }
  });

  it("defaults to local timezone", () => {
    const explicit = formatDateTime(fixedDate, "local");
    const defaulted = formatDateTime(fixedDate);
    expect(defaulted).toEqual(explicit);
  });

  it("epoch is independent of timezone choice", () => {
    expect(formatDateTime(fixedDate, "local").epoch).toBe(formatDateTime(fixedDate, "utc").epoch);
  });

  it("zero-pads single-digit month/day/hour/minute/second", () => {
    const earlyDate = new Date("2024-01-02T03:04:05.000Z");
    const result = formatDateTime(earlyDate, "utc");
    expect(result.fileName).toBe("20240102_030405");
    expect(result.display).toBe("2024/01/02 03:04:05");
  });
});

describe("stringToFormattedDateTime", () => {
  it("parses a valid 'YYYY/MM/DD HH:mm:ss' string and round-trips display", () => {
    const result = stringToFormattedDateTime("2024/03/15 10:30:45");
    expect(result.display).toBe("2024/03/15 10:30:45");
    expect(result.fileName).toBe("20240315_103045");
    // The reconstructed Date must format back to the same components in local time.
    const d = new Date(result.epoch);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(
      `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    ).toBe("2024/03/15 10:30:45");
  });

  it("round-trips formatDateTime(local) output", () => {
    const original = new Date("2024-07-04T18:00:00.000Z");
    const formatted = formatDateTime(original, "local");
    const reparsed = stringToFormattedDateTime(formatted.display);
    expect(reparsed.display).toBe(formatted.display);
    expect(reparsed.fileName).toBe(formatted.fileName);
    // Display is second-precision, so the round-tripped epoch loses millis.
    expect(reparsed.epoch).toBe(Math.floor(original.getTime() / 1000) * 1000);
  });

  it("falls back to current date/time on invalid input", () => {
    const before = Date.now();
    const result = stringToFormattedDateTime("not-a-date");
    const after = Date.now();
    expect(result.epoch).toBeGreaterThanOrEqual(before);
    expect(result.epoch).toBeLessThanOrEqual(after);
    expect(result.display).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result.fileName).toMatch(/^\d{8}_\d{6}$/);
  });

  it("falls back on wrong-format input (e.g. dashes)", () => {
    const before = Date.now();
    const result = stringToFormattedDateTime("2024-03-15 10:30:45");
    const after = Date.now();
    expect(result.epoch).toBeGreaterThanOrEqual(before);
    expect(result.epoch).toBeLessThanOrEqual(after);
  });
});

describe("getModelInfo", () => {
  it("flags claude-opus-4-7 as adaptive thinking", () => {
    const info = getModelInfo("claude-opus-4-7");
    expect(info.isThinkingEnabled).toBe(true);
    expect(info.usesAdaptiveThinking).toBe(true);
  });

  it("flags claude-opus-4-8 and higher as adaptive thinking", () => {
    expect(getModelInfo("claude-opus-4-8").usesAdaptiveThinking).toBe(true);
    expect(getModelInfo("claude-opus-4-12").usesAdaptiveThinking).toBe(true);
  });

  it("keeps claude-opus-4-6 and earlier on legacy thinking", () => {
    const six = getModelInfo("claude-opus-4-6");
    expect(six.isThinkingEnabled).toBe(true);
    expect(six.usesAdaptiveThinking).toBe(false);

    const zero = getModelInfo("claude-opus-4-0");
    expect(zero.isThinkingEnabled).toBe(true);
    expect(zero.usesAdaptiveThinking).toBe(false);
  });

  it("does not affect other thinking-enabled families", () => {
    expect(getModelInfo("claude-sonnet-4-5").usesAdaptiveThinking).toBe(false);
    expect(getModelInfo("claude-3-7-sonnet-20250219").usesAdaptiveThinking).toBe(false);
  });

  it("does not match unversioned claude-opus-4 prefix", () => {
    const bare = getModelInfo("claude-opus-4");
    expect(bare.isThinkingEnabled).toBe(true);
    expect(bare.usesAdaptiveThinking).toBe(false);
  });

  it("does not treat dated snapshot IDs as adaptive thinking minors", () => {
    // claude-opus-4-20250514 is the dated snapshot of Opus 4.0, not Opus 4.20250514.
    expect(getModelInfo("claude-opus-4-20250514").usesAdaptiveThinking).toBe(false);
    // claude-opus-4-1-20250805 is dated 4.1.
    expect(getModelInfo("claude-opus-4-1-20250805").usesAdaptiveThinking).toBe(false);
    // Dated 4.7 still matches because the minor is delimited by "-".
    expect(getModelInfo("claude-opus-4-7-20260115").usesAdaptiveThinking).toBe(true);
  });
});
