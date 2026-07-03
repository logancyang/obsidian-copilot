// Shape-pin: typing the fixtures as the real SDK output types means a future
// SDK field rename (e.g. `oldString` → `old_string`) fails THIS file at compile
// time — a loud tripwire that the runtime parser's field reads have gone stale.
import type { FileEditOutput, FileWriteOutput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { readSdkFileEditResult } from "./sdkEditResult";

describe("readSdkFileEditResult", () => {
  it("reconstructs the after-text from a FileEditOutput single replacement", () => {
    const fixture: FileEditOutput = {
      filePath: "/vault/note.md",
      oldString: "old line",
      newString: "new line",
      originalFile: "before\nold line\nafter\n",
      structuredPatch: [
        { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-old line", "+new line"] },
      ],
      userModified: false,
      replaceAll: false,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "before\nold line\nafter\n",
      newText: "before\nnew line\nafter\n",
    });
  });

  it("replaces every occurrence when replaceAll is true", () => {
    const fixture: FileEditOutput = {
      filePath: "/vault/note.md",
      oldString: "x",
      newString: "y",
      originalFile: "x a x b x",
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-x a x b x", "+y a y b y"] },
      ],
      userModified: false,
      replaceAll: true,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "x a x b x",
      newText: "y a y b y",
    });
  });

  it("inserts a newString containing $-patterns literally (no $&/$$/$` expansion)", () => {
    // `String.prototype.replace(string, string)` would expand these; the
    // reconstructed after-text must contain the `$` sequences verbatim.
    const fixture: FileEditOutput = {
      filePath: "/vault/note.md",
      oldString: "TOKEN",
      newString: "$& $$ $` $1",
      originalFile: "before TOKEN after",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-before TOKEN after", "+before $& $$ $` $1 after"],
        },
      ],
      userModified: false,
      replaceAll: false,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "before TOKEN after",
      newText: "before $& $$ $` $1 after",
    });
  });

  it("replaces only the first occurrence when replaceAll is false", () => {
    const fixture: FileEditOutput = {
      filePath: "/vault/note.md",
      oldString: "dup",
      newString: "X",
      originalFile: "dup then dup",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-dup then dup", "+X then dup"],
        },
      ],
      userModified: false,
      replaceAll: false,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "dup then dup",
      newText: "X then dup",
    });
  });

  it("falls back to a no-op when oldString is not found in originalFile", () => {
    const fixture: FileEditOutput = {
      filePath: "/vault/note.md",
      oldString: "absent",
      newString: "whatever",
      originalFile: "unchanged body",
      structuredPatch: [],
      userModified: false,
      replaceAll: false,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "unchanged body",
      newText: "unchanged body",
    });
  });

  it("maps a FileWriteOutput update to original → content", () => {
    const fixture: FileWriteOutput = {
      type: "update",
      filePath: "/vault/note.md",
      content: "the full new file body",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-old", "+the full new file body"],
        },
      ],
      originalFile: "old",
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/note.md",
      oldText: "old",
      newText: "the full new file body",
    });
  });

  it("treats a new-file create (originalFile null) as oldText empty", () => {
    const fixture: FileWriteOutput = {
      type: "create",
      filePath: "/vault/new.md",
      content: "brand new content",
      structuredPatch: [
        { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+brand new content"] },
      ],
      originalFile: null,
    };
    expect(readSdkFileEditResult(fixture)).toEqual({
      path: "/vault/new.md",
      oldText: "",
      newText: "brand new content",
    });
  });

  it("returns null for garbage / wrong-shape inputs", () => {
    expect(readSdkFileEditResult(null)).toBeNull();
    expect(readSdkFileEditResult(undefined)).toBeNull();
    expect(readSdkFileEditResult("a string")).toBeNull();
    expect(readSdkFileEditResult(42)).toBeNull();
    expect(readSdkFileEditResult({})).toBeNull();
    // A Read-style result: has content but no filePath/structuredPatch.
    expect(readSdkFileEditResult({ type: "text", file: "/x", content: "body" })).toBeNull();
    // filePath present but no structuredPatch (not a file edit/write).
    expect(readSdkFileEditResult({ filePath: "/x", content: "body" })).toBeNull();
    // structuredPatch present but neither content nor oldString/newString.
    expect(readSdkFileEditResult({ filePath: "/x", structuredPatch: [] })).toBeNull();
  });
});
