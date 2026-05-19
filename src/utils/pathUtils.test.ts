import { basename, joinPosix, normalizeAbsPath, parentDir } from "./pathUtils";

describe("normalizeAbsPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeAbsPath("C:\\a\\b")).toBe("C:/a/b");
  });

  it("strips a single trailing slash", () => {
    expect(normalizeAbsPath("/a/b/")).toBe("/a/b");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeAbsPath("/a/b///")).toBe("/a/b");
  });

  it("leaves a clean path unchanged", () => {
    expect(normalizeAbsPath("/a/b")).toBe("/a/b");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAbsPath("")).toBe("");
  });

  it("normalizes mixed separators and trailing slashes together", () => {
    expect(normalizeAbsPath("a\\b\\c\\")).toBe("a/b/c");
  });
});

describe("joinPosix", () => {
  it("joins two non-empty fragments with a single separator", () => {
    expect(joinPosix("a", "b")).toBe("a/b");
  });

  it("collapses redundant separators at the seam", () => {
    expect(joinPosix("a/", "/b")).toBe("a/b");
  });

  it("collapses multiple separators on both sides", () => {
    expect(joinPosix("a///", "///b")).toBe("a/b");
  });

  it("returns the right side when the left is empty", () => {
    expect(joinPosix("", "b")).toBe("b");
  });

  it("preserves an absolute left side", () => {
    expect(joinPosix("/a", "b")).toBe("/a/b");
  });

  it("preserves an absolute left side with trailing slash", () => {
    expect(joinPosix("/a/", "b")).toBe("/a/b");
  });
});

describe("parentDir", () => {
  it("returns the parent of a normal path", () => {
    expect(parentDir("/a/b/c")).toBe("/a/b");
  });

  it("returns / for a top-level absolute entry", () => {
    expect(parentDir("/a")).toBe("/");
  });

  it("returns / for the root itself", () => {
    expect(parentDir("/")).toBe("/");
  });

  it("strips a trailing slash before computing the parent", () => {
    expect(parentDir("/a/b/")).toBe("/a");
  });

  it("returns / when the input has no slash (no parent exists)", () => {
    expect(parentDir("file")).toBe("/");
  });
});

describe("basename", () => {
  it("returns the last segment of an absolute path", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
  });

  it("returns the input when there is no separator", () => {
    expect(basename("file.md")).toBe("file.md");
  });

  it("strips a trailing slash before extracting", () => {
    expect(basename("/a/b/")).toBe("b");
  });

  it("normalizes backslashes before extracting", () => {
    expect(basename("C:\\a\\b\\c.md")).toBe("c.md");
  });
});
