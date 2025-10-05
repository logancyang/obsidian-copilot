import { SimpleTool } from "./SimpleTool";

const mockGetChunks = jest.fn();

jest.mock("@/search/v3/chunks", () => ({
  ChunkManager: jest.fn().mockImplementation(() => ({
    getChunks: mockGetChunks,
  })),
}));

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
    mockGetChunks.mockReset();

    originalApp = global.app;
    getAbstractFileByPathMock = jest.fn();
    getMarkdownFilesMock = jest.fn().mockReturnValue([]);
    getFirstLinkpathDestMock = jest.fn().mockReturnValue(null);
    global.app = {
      vault: {
        getAbstractFileByPath: getAbstractFileByPathMock,
        getMarkdownFiles: getMarkdownFilesMock,
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

    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#1`,
        notePath,
        chunkIndex: 1,
        content: "Second chunk",
        contentHash: "hash-1",
        title: file.basename,
        heading: "Details",
        mtime: 200,
      },
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: "First chunk",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Intro",
        mtime: 100,
      },
    ]);

    const result = await readNoteTool.call({ notePath });

    expect(mockGetChunks).toHaveBeenCalledWith([notePath]);
    expect(result).toMatchObject({
      notePath,
      noteTitle: file.basename,
      heading: "Intro",
      chunkId: `${notePath}#0`,
      chunkIndex: 0,
      totalChunks: 2,
      hasMore: true,
      nextChunkIndex: 1,
      content: "First chunk",
      mtime: 100,
      linkedNotes: undefined,
    });
  });

  it("respects the requested chunk index", async () => {
    const notePath = "Notes/test.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);

    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: "First chunk",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Intro",
        mtime: 100,
      },
      {
        id: `${notePath}#1`,
        notePath,
        chunkIndex: 1,
        content: "Second chunk",
        contentHash: "hash-1",
        title: file.basename,
        heading: "Details",
        mtime: 200,
      },
    ]);

    const result = await readNoteTool.call({ notePath, chunkIndex: 1 });

    expect(result).toMatchObject({
      notePath,
      noteTitle: file.basename,
      heading: "Details",
      chunkId: `${notePath}#1`,
      chunkIndex: 1,
      totalChunks: 2,
      hasMore: false,
      nextChunkIndex: null,
      content: "Second chunk",
      mtime: 200,
      linkedNotes: undefined,
    });
  });

  it("returns out_of_range when the chunk index exceeds available chunks", async () => {
    const notePath = "Notes/test.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);

    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: "First chunk",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Intro",
        mtime: 100,
      },
    ]);

    const result = await readNoteTool.call({ notePath, chunkIndex: 5 });

    expect(result).toEqual({
      notePath,
      status: "out_of_range",
      message: "Chunk index 5 exceeds available chunks (last index 0).",
      totalChunks: 1,
    });
  });

  it("returns not_found when the note cannot be resolved", async () => {
    const notePath = "Notes/missing.md";
    getAbstractFileByPathMock.mockReturnValue(null);

    mockGetChunks.mockResolvedValue([]);

    const result = await readNoteTool.call({ notePath });

    expect(result).toEqual({
      notePath,
      status: "not_found",
      message: 'Note "Notes/missing.md" was not found or is not a readable file.',
    });
    expect(mockGetChunks).not.toHaveBeenCalled();
  });

  it("returns invalid_path when notePath starts with a leading slash", async () => {
    const result = await readNoteTool.call({ notePath: "/Projects/note.md" });

    expect(result).toEqual({
      notePath: "/Projects/note.md",
      status: "invalid_path",
      message: "Provide the note path relative to the vault root without a leading slash.",
    });
    expect(getAbstractFileByPathMock).not.toHaveBeenCalled();
    expect(mockGetChunks).not.toHaveBeenCalled();
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

    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: "Intro [[Project Plan]] details",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Intro",
        mtime: 100,
      },
    ]);

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

    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: "See [[Docs/Guide#Setup|Quick Start]] for steps.",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Intro",
        mtime: 100,
      },
    ]);

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

    mockGetChunks.mockResolvedValue([
      {
        id: `${file.path}#0`,
        notePath: file.path,
        chunkIndex: 0,
        content: "Content",
        contentHash: "hash-0",
        title: file.basename,
        heading: "Heading",
        mtime: 100,
      },
    ]);

    const result = await readNoteTool.call({ notePath: rawPath });

    expect(result.notePath).toBe(file.path);
    expect(result.chunkIndex).toBe(0);
    expect(mockGetChunks).toHaveBeenCalledWith([file.path]);
  });

  it("strips chunk headers from the returned content", async () => {
    const notePath = "Notes/header.md";
    const file = new MockTFile(notePath);
    getAbstractFileByPathMock.mockReturnValue(file);

    const header = `\n\nNOTE TITLE: [[${file.basename}]]\n\nNOTE BLOCK CONTENT:\n\n`;
    mockGetChunks.mockResolvedValue([
      {
        id: `${notePath}#0`,
        notePath,
        chunkIndex: 0,
        content: `${header}\nLine 1\nLine 2`,
        contentHash: "hash-0",
        title: file.basename,
        heading: "",
        mtime: 100,
      },
    ]);

    const result = await readNoteTool.call({ notePath });

    expect(result.content).toBe("Line 1\nLine 2");
  });
});
