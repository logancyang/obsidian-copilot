import * as Obsidian from "obsidian";
import { TFile } from "obsidian";
import {
  checkLatestVersion,
  isNewerVersion,
  extractNoteFiles,
  extractTemplateNoteFiles,
  formatDateTime,
  getModelInfo,
  getNotesFromPath,
  getNotesFromTags,
  getPropertyValuesFromNote,
  noteHasProperty,
  getUtf8ByteLength,
  insertAtCursor,
  processVariableNameForNotePath,
  removeThinkTags,
  stripFrontmatter,
  truncateToByteLimit,
  withTimeout,
} from "./utils";
import { TimeoutError } from "./error";

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
    MarkdownView: class MockMarkdownView {},
    Notice: class MockNotice {},
    requestUrl: jest.fn(),
  };
});

const mockMetadataCache = {
  getFileCache: jest.fn(),
};

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

const mockApp = {
  vault: new Obsidian.Vault(),
  metadataCache: mockMetadataCache,
} as unknown as typeof window.app;

describe("utils", () => {
  describe("getNotesFromPath()", () => {
    it("returns every markdown file for the root path", () => {
      const files = getNotesFromPath(new Obsidian.Vault(), "/");
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

    it("returns files under a folder at any depth", () => {
      const files = getNotesFromPath(new Obsidian.Vault(), "test2");
      expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test2/note3.md"]);
    });

    it("ignores a leading slash on the folder path", () => {
      const files = getNotesFromPath(new Obsidian.Vault(), "/test");
      expect(files.map((f) => f.path)).toEqual(["test/test2/note1.md", "test/note2.md"]);
    });

    it("returns a single file when the path is a file name", () => {
      const files = getNotesFromPath(new Obsidian.Vault(), "note4.md");
      expect(files.map((f) => f.path)).toEqual(["note4.md"]);
    });

    it("returns only files from the specified subfolder path", () => {
      const vault = new Obsidian.Vault();
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

    it("returns no files for an empty path", () => {
      expect(getNotesFromPath(new Obsidian.Vault(), "")).toEqual([]);
    });
  });

  describe("processVariableNameForNotePath()", () => {
    it.each([
      ["[[test]]", "test.md"],
      [" [[  test]]", "test.md"],
      ["[[ test   ]] ", "test.md"],
      [" [[ test note   ]] ", "test note.md"],
      [" [[    test_note note   ]] ", "test_note note.md"],
    ])("turns the wikilink %j into the file name %j", (input, expected) => {
      expect(processVariableNameForNotePath(input)).toBe(expected);
    });

    it.each([
      ["/testfolder", "/testfolder"],
      ["testfolder", "testfolder"],
      ["testfolder/", "testfolder/"],
      ["  testfolder ", "testfolder"],
    ])("returns the folder path %j as %j", (input, expected) => {
      expect(processVariableNameForNotePath(input)).toBe(expected);
    });
  });

  describe("getNotesFromTags()", () => {
    beforeEach(() => {
      mockMetadataCache.getFileCache.mockImplementation((file: TFile) => {
        return mockFileMetadata[file.path as keyof typeof mockFileMetadata];
      });
    });

    it("returns the files whose frontmatter has the tag", () => {
      const result = getNotesFromTags(mockApp, ["#tag1"]);

      expect(result.map((file) => file.path)).toEqual(["test/test2/note1.md", "note4.md"]);
    });

    it("returns files matching any of several tags", () => {
      const result = getNotesFromTags(mockApp, ["#tag2", "#tag4"]);

      expect(result.map((file) => file.path)).toEqual([
        "test/test2/note1.md",
        "test/note2.md",
        "note4.md",
      ]);
    });

    it("limits the search to the provided note files", () => {
      type TFileCtor = new (path: string) => TFile;
      const noteFiles: TFile[] = [
        new (TFile as unknown as TFileCtor)("test/test2/note1.md"),
        new (TFile as unknown as TFileCtor)("test/note2.md"),
      ];

      const result = getNotesFromTags(mockApp, ["#tag1"], noteFiles);

      expect(result.map((file) => file.path)).toEqual(["test/test2/note1.md"]);
    });

    it("returns no files for a tag no note has", () => {
      expect(getNotesFromTags(mockApp, ["#nonexistentTag"])).toEqual([]);
    });

    it("ignores inline tags and only considers frontmatter tags", () => {
      expect(getNotesFromTags(mockApp, ["#inlineTag1"])).toEqual([]);
    });
  });

  describe("isNewerVersion()", () => {
    it.each([
      ["4.0.8", "4.0.7", true],
      ["4.0.8", "4.0.7-dev.abc", true],
      ["4.0.8", "4.0.7+build.123", true],
      ["4.0.7", "4.0.7", false],
      ["4.0.7", "4.0.7-dev.abc", false],
      ["4.0.7", "4.0.8", false],
      ["4.1.0", "4.0.9", true],
      ["5.0.0", "4.9.9", true],
    ])("compares release %s with installed %s as %s", (latest, current, expected) => {
      expect(isNewerVersion(latest, current)).toBe(expected);
    });
  });
  describe("checkLatestVersion()", () => {
    const issueUrl = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";
    const mockedRequestUrl = Obsidian.requestUrl as jest.MockedFunction<typeof Obsidian.requestUrl>;

    beforeEach(() => {
      mockedRequestUrl.mockReset();
    });

    const manifestUrl =
      "https://github.com/logancyang/obsidian-copilot/releases/download/v4.0.4/manifest.json";
    const response = (json: unknown): Obsidian.RequestUrlResponse => ({
      status: 200,
      text: "",
      json,
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    });
    const releaseResponse = {
      tag_name: "v4.0.3",
      body: "# Copilot 4.0.4",
      html_url: "https://github.com/logancyang/obsidian-copilot/releases/tag/v4.0.4",
      assets: [{ name: "manifest.json", browser_download_url: manifestUrl }],
    };

    it(`returns release notes with the manifest version even when the tag differs for ${issueUrl}`, async () => {
      mockedRequestUrl
        .mockResolvedValueOnce(response(releaseResponse))
        .mockResolvedValueOnce(response({ version: "4.0.4" }));

      await expect(checkLatestVersion()).resolves.toEqual({
        version: "4.0.4",
        error: null,
        release: {
          version: "4.0.4",
          body: "# Copilot 4.0.4",
          htmlUrl: releaseResponse.html_url,
        },
      });
      expect(mockedRequestUrl).toHaveBeenNthCalledWith(1, {
        url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest",
        method: "GET",
      });
      expect(mockedRequestUrl).toHaveBeenNthCalledWith(2, {
        url: manifestUrl,
        method: "GET",
      });
      expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
    });

    it.each([
      undefined,
      [],
      [{ name: "main.js", browser_download_url: manifestUrl }],
      [{ name: "manifest.json" }],
    ])(
      "returns an error when the release has no downloadable manifest asset (%j)",
      async (assets) => {
        mockedRequestUrl.mockResolvedValueOnce(response({ ...releaseResponse, assets }));
        await expect(checkLatestVersion()).resolves.toEqual({
          version: null,
          error: "The latest Copilot release has no manifest.json asset.",
          release: null,
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      }
    );

    it.each([undefined, null, 404, "", "v4.0.4", "4.0", "4.0.x", "4.0.4-", "04.0.4"])(
      "returns an error for malformed manifest version %j",
      async (version) => {
        mockedRequestUrl
          .mockResolvedValueOnce(response(releaseResponse))
          .mockResolvedValueOnce(response({ version }));
        await expect(checkLatestVersion()).resolves.toEqual({
          version: null,
          error: "The latest Copilot manifest has no valid version.",
          release: null,
        });
      }
    );

    it.each(["4.0.4-beta.1", "4.0.4+build.123", "4.0.4-beta.1+build.123"])(
      "preserves valid manifest version suffixes in %s",
      async (version) => {
        mockedRequestUrl
          .mockResolvedValueOnce(response(releaseResponse))
          .mockResolvedValueOnce(response({ version }));
        await expect(checkLatestVersion()).resolves.toMatchObject({ version, error: null });
      }
    );

    it("keeps the manifest version when optional release notes are absent", async () => {
      mockedRequestUrl
        .mockResolvedValueOnce(response({ assets: releaseResponse.assets }))
        .mockResolvedValueOnce(response({ version: "4.0.4" }));
      await expect(checkLatestVersion()).resolves.toEqual({
        version: "4.0.4",
        error: null,
        release: {
          version: "4.0.4",
          body: "",
          htmlUrl: "https://github.com/logancyang/obsidian-copilot/releases/latest",
        },
      });
    });

    it("returns the request error when GitHub cannot be reached", async () => {
      mockedRequestUrl.mockRejectedValue(new Error("offline"));
      await expect(checkLatestVersion()).resolves.toEqual({
        version: null,
        error: "offline",
        release: null,
      });
    });

    it("returns the manifest request error without falling back to the release tag", async () => {
      mockedRequestUrl
        .mockResolvedValueOnce(response(releaseResponse))
        .mockRejectedValueOnce(new Error("manifest unavailable"));
      await expect(checkLatestVersion()).resolves.toEqual({
        version: null,
        error: "manifest unavailable",
        release: null,
      });
    });
  });

  describe("getPropertyValuesFromNote()", () => {
    const file = new TFile();
    const withFrontmatter = (frontmatter: Record<string, unknown>) =>
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter });

    beforeEach(() => {
      mockMetadataCache.getFileCache.mockReset();
    });

    it("returns each element of a list property as a string", () => {
      withFrontmatter({ Topics: ["Physics", "Math"] });
      expect(getPropertyValuesFromNote(mockApp, file, "Topics")).toEqual(["Physics", "Math"]);
    });

    it("wraps a scalar property in a single-element array", () => {
      withFrontmatter({ Subject: "Einstein" });
      expect(getPropertyValuesFromNote(mockApp, file, "Subject")).toEqual(["Einstein"]);
    });

    it("stringifies non-string scalar values", () => {
      withFrontmatter({ Year: 2024 });
      expect(getPropertyValuesFromNote(mockApp, file, "Year")).toEqual(["2024"]);
    });

    it("returns an empty array when the key is absent", () => {
      withFrontmatter({ Topics: ["Physics"] });
      expect(getPropertyValuesFromNote(mockApp, file, "Subject")).toEqual([]);
    });

    it("returns an empty array when the note has no frontmatter", () => {
      mockMetadataCache.getFileCache.mockReturnValue({});
      expect(getPropertyValuesFromNote(mockApp, file, "Topics")).toEqual([]);
    });

    it("drops non-scalar values instead of collapsing them to [object Object]", () => {
      withFrontmatter({ meta: { owner: "Alice" } });
      expect(getPropertyValuesFromNote(mockApp, file, "meta")).toEqual([]);
    });

    it("keeps only the scalar elements of a mixed list", () => {
      withFrontmatter({ Topics: ["Physics", { nested: true }, 2024] });
      expect(getPropertyValuesFromNote(mockApp, file, "Topics")).toEqual(["Physics", "2024"]);
    });

    it("returns an empty array for a key inherited from Object.prototype", () => {
      withFrontmatter({ Topics: "Physics" });
      expect(getPropertyValuesFromNote(mockApp, file, "constructor")).toEqual([]);
    });

    it.each([
      ["null", null],
      ["an empty list", []],
      ["a list of only non-scalar values", [{ nested: true }, { another: "object" }]],
    ])("returns the shared empty array when the value is %s", (_label, value) => {
      withFrontmatter({ Topics: value });
      const first = getPropertyValuesFromNote(mockApp, file, "Topics");
      const second = getPropertyValuesFromNote(mockApp, file, "Topics");
      expect(first).toEqual([]);
      expect(first).toBe(second);
    });
  });

  describe("noteHasProperty()", () => {
    const file = new TFile();

    beforeEach(() => {
      mockMetadataCache.getFileCache.mockReset();
    });

    it("returns true when the key is present with a value", () => {
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { Topics: "Physics" } });
      expect(noteHasProperty(mockApp, file, "Topics")).toBe(true);
    });

    it("returns true when the key is present but its value is empty or null", () => {
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { Topics: null } });
      expect(noteHasProperty(mockApp, file, "Topics")).toBe(true);

      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { Topics: [] } });
      expect(noteHasProperty(mockApp, file, "Topics")).toBe(true);
    });

    it("returns false when the key is absent", () => {
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { Subject: "x" } });
      expect(noteHasProperty(mockApp, file, "Topics")).toBe(false);
    });

    it("returns false when the note has no frontmatter", () => {
      mockMetadataCache.getFileCache.mockReturnValue({});
      expect(noteHasProperty(mockApp, file, "Topics")).toBe(false);
    });

    it("returns false for a key inherited from Object.prototype", () => {
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { Topics: "Physics" } });
      expect(noteHasProperty(mockApp, file, "constructor")).toBe(false);
      expect(noteHasProperty(mockApp, file, "toString")).toBe(false);
    });
  });

  describe("extractNoteFiles()", () => {
    const extractPaths = (query: string): string[] =>
      extractNoteFiles(query, new Obsidian.Vault()).map((f) => f.path);

    it("extracts the notes referenced by wikilinks in order", () => {
      expect(extractPaths("Please refer to [[Note1]] and [[Note2]] for more information.")).toEqual(
        ["Note1.md", "Note2.md"]
      );
    });

    it("resolves note titles containing spaces", () => {
      expect(extractPaths("Check out [[Note 1]] and [[Another Note]] for details.")).toEqual([
        "Note 1.md",
        "Another Note.md",
      ]);
    });

    it("resolves note titles containing special characters", () => {
      expect(extractPaths("Important notes: [[Note-1]], [[Note_2]], and [[Note#3]].")).toEqual([
        "Note-1.md",
        "Note_2.md",
        "Note#3.md",
      ]);
    });

    it("returns each note once when it is linked repeatedly", () => {
      expect(extractPaths("Refer to [[Note1]], [[Note2]], and [[Note1]] again.")).toEqual([
        "Note1.md",
        "Note2.md",
      ]);
    });

    it("returns no notes when the text has no wikilinks", () => {
      expect(extractPaths("There are no note titles in this string.")).toEqual([]);
    });
  });

  describe("extractTemplateNoteFiles()", () => {
    const extractPaths = (query: string): string[] =>
      extractTemplateNoteFiles(query, new Obsidian.Vault()).map((f) => f.path);

    it("extracts the notes referenced by wikilinks wrapped in curly braces in order", () => {
      expect(
        extractPaths("Please refer to {[[Note1]]} and {[[Note2]]} for more information.")
      ).toEqual(["Note1.md", "Note2.md"]);
    });

    it("resolves note titles containing spaces and special characters", () => {
      expect(
        extractPaths("Check out {[[Note 1]]}, {[[Another Note]]}, {[[Note-1]]}, and {[[Note#3]]}.")
      ).toEqual(["Note 1.md", "Another Note.md", "Note-1.md", "Note#3.md"]);
    });

    it("returns each note once when it is linked repeatedly", () => {
      expect(extractPaths("Refer to {[[Note1]]}, {[[Note2]]}, and {[[Note1]]} again.")).toEqual([
        "Note1.md",
        "Note2.md",
      ]);
    });

    it("ignores bare wikilinks that have no curly braces", () => {
      expect(extractPaths("Extract {[[Note1]]} but not [[Note2]].")).toEqual(["Note1.md"]);
      expect(extractPaths("Only [[Note1]] and [[Note2]] exist here.")).toEqual([]);
    });

    it("returns no notes when the text has no template patterns", () => {
      expect(extractPaths("There are no template note patterns in this string.")).toEqual([]);
    });
  });

  describe("removeThinkTags()", () => {
    it("removes complete think blocks, including multi-line content with inner tags", () => {
      const input = `Main text <think>
I need to consider:
- Point 1
<inner>nested content</inner>
</think> Final text`;
      expect(removeThinkTags(input)).toBe("Main text  Final text");
    });

    it("removes every think block in the text", () => {
      const input = "Text <think>First thought</think> middle <think>Second thought</think> end";
      expect(removeThinkTags(input)).toBe("Text  middle  end");
    });

    it("drops an unclosed think block while it is still streaming", () => {
      const input = "Before content <think>Partial thought that is still being";
      expect(removeThinkTags(input)).toBe("Before content");
    });

    it("removes an empty think block", () => {
      expect(removeThinkTags("Text <think></think> more text")).toBe("Text  more text");
    });

    it("keeps the text around a think block at the start or end", () => {
      expect(removeThinkTags("<think>Initial thoughts</think>Main content here")).toBe(
        "Main content here"
      );
      expect(removeThinkTags("Main content here<think>Final thoughts</think>")).toBe(
        "Main content here"
      );
    });

    it("returns text without think blocks unchanged apart from trimming", () => {
      expect(removeThinkTags("  regular text  ")).toBe("regular text");
      expect(removeThinkTags("  <think>content</think>  ")).toBe("");
    });
  });

  describe("withTimeout()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const sleepThen = <T>(ms: number, run: () => T) => {
      return async () => {
        await new Promise((resolve) => window.setTimeout(resolve, ms));
        return run();
      };
    };

    it("resolves with the operation result when it finishes within the timeout", async () => {
      const pending = withTimeout(
        sleepThen(50, () => "success"),
        200,
        "Test operation"
      );

      await jest.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toBe("success");
    });

    it("rejects with a TimeoutError naming the operation and limit when the operation is too slow", async () => {
      const pending = withTimeout(
        sleepThen(200, () => "late"),
        50,
        "Test operation"
      );
      const assertion = expect(pending).rejects.toThrow(TimeoutError);

      await jest.advanceTimersByTimeAsync(50);

      await assertion;
      await expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: "Test operation timed out after 50ms",
      });
    });

    it("aborts the operation's signal when the timeout is reached", async () => {
      let signalSeen: AbortSignal | undefined;
      const pending = withTimeout(
        async (signal) => {
          signalSeen = signal;
          await new Promise((resolve) => window.setTimeout(resolve, 200));
        },
        50,
        "Test operation"
      );
      const assertion = expect(pending).rejects.toThrow(TimeoutError);

      await jest.advanceTimersByTimeAsync(50);

      await assertion;
      expect(signalSeen?.aborted).toBe(true);
    });

    it("propagates non-timeout errors from the operation and clears the timer", async () => {
      const pending = withTimeout(
        sleepThen(50, () => {
          throw new Error("Operation failed");
        }),
        200,
        "Test operation"
      );
      const assertion = expect(pending).rejects.toThrow("Operation failed");

      await jest.advanceTimersByTimeAsync(50);

      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("getUtf8ByteLength()", () => {
    it.each([
      ["ASCII", "Test 123", 8],
      ["Cyrillic", "Привет", 12],
      ["Chinese, Japanese, and Korean", "你好こんにちは안녕", 27],
      ["emoji", "🚀🌟", 8],
      ["mixed scripts", "Hello мир 你好", 19],
      ["an empty string", "", 0],
    ])("counts the bytes of %s text", (_label, text, expected) => {
      expect(getUtf8ByteLength(text)).toBe(expected);
    });
  });

  describe("truncateToByteLimit()", () => {
    it("returns the string unchanged when it fits the limit", () => {
      expect(truncateToByteLimit("Hello", 10)).toBe("Hello");
      expect(truncateToByteLimit("Test", 4)).toBe("Test");
    });

    it("cuts ASCII text at the byte limit", () => {
      expect(truncateToByteLimit("Hello World", 5)).toBe("Hello");
    });

    it("never splits a multi-byte character", () => {
      expect(truncateToByteLimit("Привет мир", 13)).toBe("Привет ");
      expect(truncateToByteLimit("🚀🌟✨🎉", 8)).toBe("🚀🌟");
      expect(truncateToByteLimit("Hello мир 你好", 12)).toBe("Hello мир");
    });

    it("keeps the result within the limit when the first character alone exceeds it", () => {
      expect(getUtf8ByteLength(truncateToByteLimit("🚀Test", 3))).toBeLessThanOrEqual(3);
    });

    it("returns an empty string for a zero or negative limit", () => {
      expect(truncateToByteLimit("Hello", 0)).toBe("");
      expect(truncateToByteLimit("Hello", -1)).toBe("");
    });

    it("returns an empty string for an empty input", () => {
      expect(truncateToByteLimit("", 10)).toBe("");
    });
  });

  describe("stripFrontmatter()", () => {
    it("removes the leading YAML frontmatter block", () => {
      const content = `---
title: "Quoted String"
count: 42
tags:
  - tag1
---
This is the actual content.`;
      expect(stripFrontmatter(content)).toBe("This is the actual content.");
    });

    it("trims leading whitespace after the frontmatter by default", () => {
      const content = `---
title: Test
---

  Content with leading whitespace after frontmatter.`;
      expect(stripFrontmatter(content)).toBe("Content with leading whitespace after frontmatter.");
    });

    it("keeps later --- separators in the body", () => {
      const content = `---
title: Test
---
Content with --- separator in the middle.`;
      expect(stripFrontmatter(content)).toBe("Content with --- separator in the middle.");
    });

    it("returns content without frontmatter unchanged", () => {
      expect(stripFrontmatter("This is content without frontmatter.")).toBe(
        "This is content without frontmatter."
      );
      expect(stripFrontmatter("")).toBe("");
    });

    it("returns content unchanged when the opening --- has no closing ---", () => {
      const content = "---\nThis is not valid frontmatter";
      expect(stripFrontmatter(content)).toBe(content);
    });

    it("preserves leading whitespace after the frontmatter when trimStart is false", () => {
      const content = `---
title: Test
---

  Content after empty line.`;
      expect(stripFrontmatter(content, { trimStart: false })).toBe("\n  Content after empty line.");
    });

    it("strips CRLF frontmatter when trimStart is false", () => {
      const content = "---\r\ntitle: Test\r\n---\r\n  Content here.";
      expect(stripFrontmatter(content, { trimStart: false })).toBe("  Content here.");
    });
  });

  describe("formatDateTime()", () => {
    const fixedDate = new Date("2024-03-15T14:30:45.123Z");

    it("formats UTC deterministically when timezone is utc", () => {
      const result = formatDateTime(fixedDate, "utc");
      expect(result.fileName).toBe("20240315_143045");
      expect(result.display).toBe("2024/03/15 14:30:45");
      expect(result.epoch).toBe(fixedDate.getTime());
    });

    it("zero-pads single-digit month, day, hour, minute, and second", () => {
      const result = formatDateTime(new Date("2024-01-02T03:04:05.000Z"), "utc");
      expect(result.fileName).toBe("20240102_030405");
      expect(result.display).toBe("2024/01/02 03:04:05");
    });

    it("formats local time using the host timezone", () => {
      const result = formatDateTime(fixedDate, "local");
      const pad = (n: number) => String(n).padStart(2, "0");
      const expectedDisplay =
        `${fixedDate.getFullYear()}/${pad(fixedDate.getMonth() + 1)}/${pad(fixedDate.getDate())} ` +
        `${pad(fixedDate.getHours())}:${pad(fixedDate.getMinutes())}:${pad(fixedDate.getSeconds())}`;

      expect(result.display).toBe(expectedDisplay);
      expect(result.fileName).toMatch(/^\d{8}_\d{6}$/);
      expect(result.epoch).toBe(fixedDate.getTime());
    });

    it("defaults to local timezone", () => {
      expect(formatDateTime(fixedDate)).toEqual(formatDateTime(fixedDate, "local"));
    });
  });

  describe("getModelInfo()", () => {
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

    it("does not match the unversioned claude-opus-4 prefix", () => {
      const bare = getModelInfo("claude-opus-4");
      expect(bare.isThinkingEnabled).toBe(true);
      expect(bare.usesAdaptiveThinking).toBe(false);
    });

    it("does not treat dated snapshot IDs as adaptive thinking minors", () => {
      expect(getModelInfo("claude-opus-4-20250514").usesAdaptiveThinking).toBe(false);
      expect(getModelInfo("claude-opus-4-1-20250805").usesAdaptiveThinking).toBe(false);
      expect(getModelInfo("claude-opus-4-7-20260115").usesAdaptiveThinking).toBe(true);
    });
  });

  describe("insertAtCursor()", () => {
    const from = { line: 0, ch: 0 };
    const to = { line: 0, ch: 5 };

    function makeApp(selection: string) {
      const editor = {
        getSelection: jest.fn(() => selection),
        getCursor: jest.fn((which: string) => (which === "from" ? from : to)),
        replaceRange: jest.fn(),
        setSelection: jest.fn(),
        focus: jest.fn(),
        cm: undefined,
      };
      const view = new (Obsidian.MarkdownView as unknown as new () => { editor: unknown })();
      view.editor = editor;
      const leaf = { view };
      const app = {
        workspace: {
          getMostRecentLeaf: jest.fn(() => leaf),
          getLeaf: jest.fn(() => leaf),
        },
      };
      return { app, editor };
    }

    it("inserts at the cursor when there is no selection", async () => {
      const { app, editor } = makeApp("");

      await insertAtCursor(app as never, "hello");

      expect(editor.replaceRange).toHaveBeenCalledWith("hello", to, to);
    });

    it("replaces from the selection start when text is selected", async () => {
      const { app, editor } = makeApp("selected");

      await insertAtCursor(app as never, "hello");

      expect(editor.replaceRange).toHaveBeenCalledWith("hello", from, to);
    });

    it("does nothing when there is no markdown view to insert into", async () => {
      const leaf = { view: {} };
      const app = {
        workspace: {
          getMostRecentLeaf: jest.fn(() => leaf),
          getLeaf: jest.fn(() => leaf),
        },
      };

      await expect(insertAtCursor(app as never, "hello")).resolves.toBeUndefined();
    });
  });
});
