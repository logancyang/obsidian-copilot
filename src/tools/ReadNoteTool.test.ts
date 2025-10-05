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
    this.basename = path.split("/").pop() || path;
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

  beforeEach(async () => {
    jest.resetModules();
    mockGetChunks.mockReset();

    originalApp = global.app;
    getAbstractFileByPathMock = jest.fn();
    global.app = {
      vault: {
        getAbstractFileByPath: getAbstractFileByPathMock,
      },
      metadataCache: {
        getFileCache: jest.fn(),
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
    expect(result).toEqual({
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

    expect(result).toEqual({
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
});
