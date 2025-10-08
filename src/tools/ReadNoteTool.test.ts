import { SimpleTool } from "./SimpleTool";

const mockCachedRead = jest.fn();

class MockTFile {
  path: string;
  basename: string;
  stat: { mtime: number };

  constructor(path: string) {
    this.path = path;
    const fileName = path.split("/").pop() || path;
    this.basename = fileName.replace(/\.[^/.]+$/, "");
    this.stat = { mtime: Date.now() };
  }
}

jest.mock("obsidian", () => ({
  TFile: MockTFile,
}));

describe("readNoteTool", () => {
  let readNoteTool: SimpleTool<any, any>;
  let originalApp: any;
  let getAbstractFileByPathMock: jest.Mock;
  let getMarkdownFilesMock: jest.Mock;
  let getFirstLinkpathDestMock: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();

    originalApp = global.app;
    getAbstractFileByPathMock = jest.fn();
    getMarkdownFilesMock = jest.fn().mockReturnValue([]);
    getFirstLinkpathDestMock = jest.fn().mockReturnValue(null);
    mockCachedRead.mockReset();
    mockCachedRead.mockResolvedValue("");

    global.app = {
      vault: {
        getAbstractFileByPath: getAbstractFileByPathMock,
        getMarkdownFiles: getMarkdownFilesMock,
        cachedRead: mockCachedRead,
      },
      metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: getFirstLinkpathDestMock,
      },
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
        getActiveFile: jest.fn().mockReturnValue(null),
      },
    } as any;

    ({ readNoteTool } = await import("./NoteTools"));
  });

  afterEach(() => {
    global.app = originalApp;
  });

  it("returns the first chunk with follow-up metadata", async () => {
    const notePath = "Notes/test.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);
    mockCachedRead.mockResolvedValue(["## Heading", "Line 1", "Line 2"].join("\n"));

    const result = await readNoteTool.call({ notePath });

    expect(result.notePath).toBe(notePath);
    expect(result.totalChunks).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.content).toBe(["## Heading", "Line 1", "Line 2"].join("\n"));
  });

  it("respects the requested chunk index", async () => {
    const notePath = "Notes/multi.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);

    const lines = Array.from({ length: 210 }, (_, i) => `Line ${i + 1}`);
    mockCachedRead.mockResolvedValue(lines.join("\n"));

    const result = await readNoteTool.call({ notePath, chunkIndex: 1 });

    expect(result.chunkIndex).toBe(1);
    expect(result.content).toBe(lines.slice(200).join("\n"));
  });

  it("accepts chunkIndex provided as a string", async () => {
    const notePath = "Notes/string-index.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);

    const lines = Array.from({ length: 205 }, (_, i) => `Line ${i + 1}`);
    mockCachedRead.mockResolvedValue(lines.join("\n"));

    const result = await readNoteTool.call({ notePath, chunkIndex: "1" as any });

    expect(result.chunkIndex).toBe(1);
    expect(result.content).toBe(lines.slice(200).join("\n"));
  });

  it("returns not_found when the note cannot be resolved", async () => {
    const notePath = "Notes/missing.md";
    getAbstractFileByPathMock.mockReturnValue(null);

    const result = await readNoteTool.call({ notePath });

    expect(result).toEqual({
      notePath,
      status: "not_found",
      message: 'Note "Notes/missing.md" was not found or is not a readable file.',
    });
    expect(mockCachedRead).not.toHaveBeenCalled();
  });

  it("returns invalid_path when notePath starts with a leading slash", async () => {
    const result = await readNoteTool.call({ notePath: "/Projects/note.md" });

    expect(result).toEqual({
      notePath: "/Projects/note.md",
      status: "invalid_path",
      message: "Provide the note path relative to the vault root without a leading slash.",
    });
    expect(getAbstractFileByPathMock).not.toHaveBeenCalled();
    expect(mockCachedRead).not.toHaveBeenCalled();
  });

  it("surfaces linked note candidates including duplicate basenames", async () => {
    const notePath = "Notes/source.md";
    const file = new MockTFile(notePath);
    const candidatePrimary = new MockTFile("Projects/Project Plan.md");
    const candidateDuplicate = new MockTFile("Archive/Project Plan.md");

    getAbstractFileByPathMock.mockReturnValue(file);
    getFirstLinkpathDestMock.mockImplementation((link: string) =>
      link === "Project Plan" ? candidatePrimary : null
    );
    getMarkdownFilesMock.mockReturnValue([candidatePrimary, candidateDuplicate, file]);
    mockCachedRead.mockResolvedValue("Intro [[Project Plan]] details");

    const result = await readNoteTool.call({ notePath });

    expect(result.linkedNotes).toEqual([
      {
        linkText: "Project Plan",
        displayText: "Project Plan",
        section: undefined,
        candidates: [
          { path: candidatePrimary.path, title: candidatePrimary.basename },
          { path: candidateDuplicate.path, title: candidateDuplicate.basename },
        ],
      },
    ]);
  });

  it("captures alias and section metadata for wiki links", async () => {
    const notePath = "Notes/source.md";
    const file = new MockTFile(notePath);
    const guideFile = new MockTFile("Docs/Guide.md");

    getAbstractFileByPathMock.mockReturnValue(file);
    getFirstLinkpathDestMock.mockImplementation((link: string) =>
      link === "Docs/Guide" ? guideFile : null
    );
    getMarkdownFilesMock.mockReturnValue([guideFile, file]);
    mockCachedRead.mockResolvedValue("See [[Docs/Guide#Setup|Quick Start]] for steps.");

    const result = await readNoteTool.call({ notePath });

    expect(result.linkedNotes).toEqual([
      {
        linkText: "Docs/Guide",
        displayText: "Quick Start",
        section: "Setup",
        candidates: [{ path: guideFile.path, title: guideFile.basename }],
      },
    ]);
  });

  it("resolves note paths without an explicit extension", async () => {
    const rawPath = "Notes/extensionless";
    const file = new MockTFile(`${rawPath}.md`);

    getAbstractFileByPathMock.mockImplementation((path: string) => {
      if (path === rawPath) {
        return null;
      }
      if (path === `${rawPath}.md`) {
        return file;
      }
      return null;
    });

    mockCachedRead.mockResolvedValue("Content");

    const result = await readNoteTool.call({ notePath: rawPath });

    expect(result.notePath).toBe(file.path);
    expect(result.chunkIndex).toBe(0);
    expect(mockCachedRead).toHaveBeenCalledWith(file);
  });

  it("resolves wiki-linked notes via metadata without active note context", async () => {
    const requestedPath = "Project Plan";
    const targetFile = new MockTFile("Projects/Project Plan.md");

    getAbstractFileByPathMock.mockReturnValue(null);
    getFirstLinkpathDestMock.mockImplementation((link: string, source: string) => {
      if (link === requestedPath && source === "") {
        return targetFile;
      }
      return null;
    });
    mockCachedRead.mockResolvedValue("Content");

    const result = await readNoteTool.call({ notePath: requestedPath });

    expect(result.notePath).toBe(targetFile.path);
    expect(mockCachedRead).toHaveBeenCalledWith(targetFile);
    expect(getFirstLinkpathDestMock).toHaveBeenCalledWith(requestedPath, "");
  });

  it("falls back to a unique basename match when metadata resolution fails", async () => {
    const requestedPath = "Solo Note";
    const targetFile = new MockTFile("Area/Solo Note.md");

    getAbstractFileByPathMock.mockReturnValue(null);
    getFirstLinkpathDestMock.mockReturnValue(null);
    getMarkdownFilesMock.mockReturnValue([targetFile]);
    mockCachedRead.mockResolvedValue("Content");

    const result = await readNoteTool.call({ notePath: requestedPath });

    expect(result.notePath).toBe(targetFile.path);
    expect(mockCachedRead).toHaveBeenCalledWith(targetFile);
  });

  it("returns not_unique when multiple notes share the same title", async () => {
    const requestedPath = "Project Plan";
    const projectFile = new MockTFile("Projects/Project Plan.md");
    const archiveFile = new MockTFile("Archive/Project Plan.md");

    getAbstractFileByPathMock.mockReturnValue(null);
    getFirstLinkpathDestMock.mockReturnValue(null);
    getMarkdownFilesMock.mockReturnValue([projectFile, archiveFile]);

    const result = await readNoteTool.call({ notePath: requestedPath });

    expect(result).toEqual({
      notePath: requestedPath,
      status: "not_unique",
      message: 'Multiple notes match "Project Plan". Provide a more specific path.',
      candidates: [
        { path: projectFile.path, title: projectFile.basename },
        { path: archiveFile.path, title: archiveFile.basename },
      ],
    });
    expect(mockCachedRead).not.toHaveBeenCalled();
  });

  it("matches a unique partial path when multiple basenames exist", async () => {
    const requestedPath = "Projects/Project Plan";
    const targetFile = new MockTFile("Projects/Project Plan.md");
    const duplicateFile = new MockTFile("Archive/Project Plan.md");

    getAbstractFileByPathMock.mockReturnValue(null);
    getFirstLinkpathDestMock.mockReturnValue(null);
    getMarkdownFilesMock.mockReturnValue([targetFile, duplicateFile]);
    mockCachedRead.mockResolvedValue("Content");

    const result = await readNoteTool.call({ notePath: requestedPath });

    expect(result.notePath).toBe(targetFile.path);
    expect(mockCachedRead).toHaveBeenCalledWith(targetFile);
  });
});
