import {
  cursorBinarySearchDirs,
  resolveCursorBinary,
  type CursorBinaryResolverFs,
  type CursorBinaryResolverInput,
} from "./cursorBinaryResolver";

function makeFs(paths: Iterable<string>): CursorBinaryResolverFs {
  const set = new Set(paths);
  return {
    existsSync: (filePath: string) => set.has(filePath),
    readFileSync: () => {
      throw new Error("unread");
    },
    readdirSync: () => [],
  };
}

function unixInput(
  fs: CursorBinaryResolverFs,
  overrides: Partial<CursorBinaryResolverInput> = {}
): CursorBinaryResolverInput {
  return {
    homeDir: "/home/me",
    platform: "linux",
    env: {},
    fs,
    ...overrides,
  };
}

function winInput(
  fs: CursorBinaryResolverFs,
  overrides: Partial<CursorBinaryResolverInput> = {}
): CursorBinaryResolverInput {
  return {
    homeDir: "C:\\Users\\me",
    platform: "win32",
    env: {},
    fs,
    ...overrides,
  };
}

describe("cursorBinaryResolver", () => {
  describe("resolveCursorBinary()", () => {
    it("returns a saved installation when that file exists", () => {
      const fs = makeFs(["/custom/agent"]);
      expect(resolveCursorBinary(unixInput(fs, { override: "/custom/agent" }))).toBe(
        "/custom/agent"
      );
    });

    it("falls through to the official install when the saved path is missing", () => {
      const fs = makeFs(["/home/me/.local/bin/agent"]);
      expect(resolveCursorBinary(unixInput(fs, { override: "/missing" }))).toBe(
        "/home/me/.local/bin/agent"
      );
    });

    it("uses ~/.local/bin/agent before a legacy cursor-agent executable", () => {
      const fs = makeFs(["/home/me/.local/bin/agent", "/usr/local/bin/cursor-agent"]);
      expect(resolveCursorBinary(unixInput(fs))).toBe("/home/me/.local/bin/agent");
    });

    it("uses a legacy cursor-agent executable when the current name is not installed", () => {
      const fs = makeFs(["/opt/homebrew/bin/cursor-agent"]);
      expect(resolveCursorBinary(unixInput(fs))).toBe("/opt/homebrew/bin/cursor-agent");
    });

    it("ignores an unrelated agent executable outside Cursor's install directories", () => {
      const fs = makeFs(["/usr/bin/agent", "/opt/homebrew/bin/agent"]);
      expect(resolveCursorBinary(unixInput(fs))).toBeNull();
    });

    it("finds the Windows install under the user profile", () => {
      const fs = makeFs(["C:\\Users\\me\\.local\\bin\\agent.exe"]);
      expect(resolveCursorBinary(winInput(fs))).toBe("C:\\Users\\me\\.local\\bin\\agent.exe");
    });
  });

  describe("cursorBinarySearchDirs()", () => {
    it("names the official install directory before other locations", () => {
      expect(cursorBinarySearchDirs(unixInput(makeFs([])))[0]).toBe("/home/me/.local/bin");
    });
  });
});
