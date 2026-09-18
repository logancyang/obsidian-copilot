import {
  diffTargetPaths,
  editTargetPaths,
  isCapturableVaultPath,
  primaryEditTargetPath,
} from "@/agentMode/session/editTargets";

describe("editTargets", () => {
  const VAULT = "/Users/me/vault";

  describe("diffTargetPaths()", () => {
    it("collects each diff output's path once, in arrival order", () => {
      expect(
        diffTargetPaths([
          { type: "diff", path: "notes/b.md" },
          { type: "content" },
          { type: "diff", path: "notes/a.md" },
          { type: "diff", path: "notes/b.md" },
        ])
      ).toEqual(["notes/b.md", "notes/a.md"]);
    });

    it("returns nothing for a call with no outputs", () => {
      expect(diffTargetPaths(undefined)).toEqual([]);
      expect(diffTargetPaths([{ type: "diff", path: "" }])).toEqual([]);
    });
  });

  describe("primaryEditTargetPath()", () => {
    it("prefers the first reported location and makes it vault-relative", () => {
      expect(
        primaryEditTargetPath(
          {
            locations: [{ path: `${VAULT}/notes/a.md` }, { path: `${VAULT}/notes/b.md` }],
            input: { file_path: `${VAULT}/other.md` },
          },
          VAULT
        )
      ).toBe("notes/a.md");
    });

    it("falls back through file_path, filePath and path in the tool input", () => {
      expect(primaryEditTargetPath({ input: { file_path: "notes/a.md" } }, VAULT)).toBe(
        "notes/a.md"
      );
      expect(primaryEditTargetPath({ input: { filePath: "notes/b.md" } }, VAULT)).toBe(
        "notes/b.md"
      );
      expect(primaryEditTargetPath({ input: { path: "notes/c.md" } }, VAULT)).toBe("notes/c.md");
    });

    it("uses the sole diff path when the call names its target only in its output", () => {
      expect(primaryEditTargetPath({ diffPaths: [`${VAULT}/notes/a.md`] }, VAULT)).toBe(
        "notes/a.md"
      );
    });

    it("returns null when the call has no target or patches several files", () => {
      expect(primaryEditTargetPath({}, VAULT)).toBeNull();
      expect(primaryEditTargetPath({ diffPaths: ["notes/a.md", "notes/b.md"] }, VAULT)).toBeNull();
    });

    it("leaves a path outside the vault absolute", () => {
      expect(primaryEditTargetPath({ input: { file_path: "/tmp/scratch.md" } }, VAULT)).toBe(
        "/tmp/scratch.md"
      );
    });
  });

  describe("editTargetPaths()", () => {
    it("unions every file a batch patch call touches, deduped and vault-relative", () => {
      expect(
        editTargetPaths(
          {
            locations: [{ path: `${VAULT}/notes/a.md` }],
            input: { file_path: `${VAULT}/notes/b.md` },
            diffPaths: [`${VAULT}/notes/b.md`, `${VAULT}/notes/c.md`],
          },
          VAULT
        )
      ).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"]);
    });

    it("returns nothing when the call names no file", () => {
      expect(editTargetPaths({ input: { command: "ls" } }, VAULT)).toEqual([]);
    });
  });

  describe("isCapturableVaultPath()", () => {
    it("accepts a vault-relative note path", () => {
      expect(isCapturableVaultPath("notes/diff-demo/a.md")).toBe(true);
    });

    it("rejects a path that stayed absolute because it lies outside the vault", () => {
      expect(isCapturableVaultPath("/tmp/scratch.md")).toBe(false);
      expect(isCapturableVaultPath("C:\\tmp\\scratch.md")).toBe(false);
    });

    it("rejects hidden configuration folders and paths escaping the vault", () => {
      expect(isCapturableVaultPath(".config/plugins/copilot/data.json")).toBe(false);
      expect(isCapturableVaultPath("notes/.trash/a.md")).toBe(false);
      expect(isCapturableVaultPath("../outside.md")).toBe(false);
    });

    it("rejects an empty path", () => {
      expect(isCapturableVaultPath("")).toBe(false);
    });
  });
});
