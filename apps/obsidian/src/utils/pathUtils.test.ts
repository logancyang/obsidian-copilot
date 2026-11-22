import {
  basename,
  collapseHomeDir,
  joinPosix,
  normalizeAbsPath,
  parentDir,
  resolvesInto,
} from "./pathUtils";

describe("pathUtils", () => {
  describe("normalizeAbsPath()", () => {
    it("converts backslashes to forward slashes", () => {
      expect(normalizeAbsPath("C:\\a\\b")).toBe("C:/a/b");
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

  describe("joinPosix()", () => {
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
  });

  describe("parentDir()", () => {
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

  describe("basename()", () => {
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

  describe("collapseHomeDir()", () => {
    it("replaces a leading home prefix with ~", () => {
      expect(collapseHomeDir("/Users/alice/.local/bin/claude", "/Users/alice")).toBe(
        "~/.local/bin/claude"
      );
    });

    it("collapses a path equal to the home directory to ~", () => {
      expect(collapseHomeDir("/Users/alice", "/Users/alice")).toBe("~");
    });

    it("tolerates a trailing slash on the home directory", () => {
      expect(collapseHomeDir("/Users/alice/bin", "/Users/alice/")).toBe("~/bin");
    });

    it("leaves paths outside the home directory unchanged", () => {
      expect(collapseHomeDir("/opt/homebrew/bin/codex", "/Users/alice")).toBe(
        "/opt/homebrew/bin/codex"
      );
    });

    it("does not match a sibling dir that shares the home prefix", () => {
      expect(collapseHomeDir("/Users/alice2/bin", "/Users/alice")).toBe("/Users/alice2/bin");
    });

    it("preserves Windows separators in the suffix", () => {
      expect(collapseHomeDir("C:\\Users\\alice\\bin\\codex.exe", "C:\\Users\\alice")).toBe(
        "~\\bin\\codex.exe"
      );
    });

    it("matches case-insensitively when requested (Windows)", () => {
      expect(collapseHomeDir("C:\\USERS\\Alice\\bin", "C:\\Users\\alice", true)).toBe("~\\bin");
    });

    it("matches case-sensitively by default", () => {
      expect(collapseHomeDir("/USERS/alice/bin", "/Users/alice")).toBe("/USERS/alice/bin");
    });

    it("returns the input unchanged when home is empty", () => {
      expect(collapseHomeDir("/Users/alice/bin", "")).toBe("/Users/alice/bin");
    });

    it("matches when absolutePath uses forward slashes but homeDir uses backslashes", () => {
      expect(collapseHomeDir("C:/Users/Alice/bin/codex.exe", "C:\\Users\\Alice", true)).toBe(
        "~/bin/codex.exe"
      );
    });

    it("matches when absolutePath uses backslashes but homeDir uses forward slashes", () => {
      expect(collapseHomeDir("C:\\Users\\Alice\\bin\\codex.exe", "C:/Users/Alice", true)).toBe(
        "~\\bin\\codex.exe"
      );
    });

    it("preserves original suffix separators when separators are mixed", () => {
      expect(collapseHomeDir("C:/Users/Alice\\bin/codex.exe", "C:\\Users\\Alice", true)).toBe(
        "~\\bin/codex.exe"
      );
    });
  });

  describe("resolvesInto()", () => {
    it("accepts a target equal to the root or nested inside it, across separator styles", () => {
      expect(resolvesInto("/vault", "/vault/")).toBe(true);
      expect(resolvesInto("/vault/a/b.md", "/vault")).toBe(true);
      expect(resolvesInto("C:\\vault\\a", "C:/vault")).toBe(true);
    });

    it("rejects a sibling directory that shares the root's name prefix", () => {
      expect(resolvesInto("/vault-other/a.md", "/vault")).toBe(false);
    });
  });
});
