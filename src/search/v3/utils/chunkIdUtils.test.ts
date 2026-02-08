import { extractNotePathFromChunkId } from "./chunkIdUtils";

describe("extractNotePathFromChunkId", () => {
  it("should extract note path from chunk ID with numeric suffix", () => {
    expect(extractNotePathFromChunkId("note.md#0")).toBe("note.md");
    expect(extractNotePathFromChunkId("note.md#12")).toBe("note.md");
  });

  it("should handle folder paths", () => {
    expect(extractNotePathFromChunkId("folder/note.md#0")).toBe("folder/note.md");
    expect(extractNotePathFromChunkId("a/b/c/note.md#3")).toBe("a/b/c/note.md");
  });

  it("should return plain note paths unchanged", () => {
    expect(extractNotePathFromChunkId("note.md")).toBe("note.md");
    expect(extractNotePathFromChunkId("folder/note.md")).toBe("folder/note.md");
  });

  it("should handle empty string", () => {
    expect(extractNotePathFromChunkId("")).toBe("");
  });

  it("should handle note names containing hashes by using lastIndexOf", () => {
    // A note named "C#.md" with chunk suffix
    expect(extractNotePathFromChunkId("C#.md#0")).toBe("C#.md");
  });
});
