import {
  resolveOpencodeBinary,
  type OpencodeBinaryResolverFs,
  type OpencodeBinaryResolverInput,
} from "./opencodeBinaryResolver";

function makeFs(paths: Iterable<string>): OpencodeBinaryResolverFs {
  const set = new Set(paths);
  return {
    existsSync: (p: string) => set.has(p),
    readFileSync: (p: string) => {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
    readdirSync: (p: string) => {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

function unixInput(
  fs: OpencodeBinaryResolverFs,
  overrides: Partial<OpencodeBinaryResolverInput> = {}
): OpencodeBinaryResolverInput {
  return {
    homeDir: "/home/me",
    platform: "linux",
    env: {},
    fs,
    ...overrides,
  };
}

function winInput(
  fs: OpencodeBinaryResolverFs,
  overrides: Partial<OpencodeBinaryResolverInput> = {}
): OpencodeBinaryResolverInput {
  return {
    homeDir: "C:\\Users\\me",
    platform: "win32",
    env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
    fs,
    ...overrides,
  };
}

describe("opencodeBinaryResolver", () => {
  describe("resolveOpencodeBinary()", () => {
    it("returns the override path when it exists", () => {
      const fs = makeFs(["/custom/opencode"]);
      expect(resolveOpencodeBinary(unixInput(fs, { override: "/custom/opencode" }))).toBe(
        "/custom/opencode"
      );
    });

    it("falls back to detection when the override path does not exist", () => {
      const native = "/home/me/.opencode/bin/opencode";
      const fs = makeFs([native]);
      expect(
        resolveOpencodeBinary(
          unixInput(fs, { override: "C:\\Users\\someone\\.opencode\\bin\\opencode.exe" })
        )
      ).toBe(native);
    });

    it("finds the native installer at ~/.opencode/bin/opencode on linux", () => {
      const fs = makeFs(["/home/me/.opencode/bin/opencode"]);
      expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.opencode/bin/opencode");
    });

    it("finds the bun install at ~/.bun/bin/opencode on linux", () => {
      const fs = makeFs(["/home/me/.bun/bin/opencode"]);
      expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.bun/bin/opencode");
    });

    it("finds /opt/homebrew/bin/opencode on linux", () => {
      const fs = makeFs(["/opt/homebrew/bin/opencode"]);
      expect(resolveOpencodeBinary(unixInput(fs))).toBe("/opt/homebrew/bin/opencode");
    });

    it("prefers the native installer over /usr/local/bin on linux", () => {
      const fs = makeFs(["/home/me/.opencode/bin/opencode", "/usr/local/bin/opencode"]);
      expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.opencode/bin/opencode");
    });

    it("returns null on linux when no candidate exists", () => {
      expect(resolveOpencodeBinary(unixInput(makeFs([])))).toBeNull();
    });

    it("finds the native installer at ~/.opencode/bin/opencode.exe on windows", () => {
      const p = "C:\\Users\\me\\.opencode\\bin\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("finds the bun install at ~/.bun/bin/opencode.exe on windows", () => {
      const p = "C:\\Users\\me\\.bun\\bin\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("finds ~/.local/bin/opencode.exe on windows", () => {
      const p = "C:\\Users\\me\\.local\\bin\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("finds opencode.exe under %LOCALAPPDATA% when the env var is set", () => {
      const p = "D:\\AppData\\Local\\opencode\\bin\\opencode.exe";
      expect(
        resolveOpencodeBinary(
          winInput(makeFs([p]), { env: { LOCALAPPDATA: "D:\\AppData\\Local" } })
        )
      ).toBe(p);
    });

    it("finds opencode.exe under <homeDir>\\AppData\\Local when LOCALAPPDATA is unset", () => {
      const p = "C:\\Users\\me\\AppData\\Local\\opencode\\bin\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("finds opencode.exe under %ProgramFiles%", () => {
      const p = "C:\\Program Files\\opencode\\bin\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("finds opencode.exe under %APPDATA%\\npm", () => {
      const p = "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe";
      expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
    });

    it("returns null on windows when only opencode.cmd exists", () => {
      const fs = makeFs(["C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd"]);
      expect(resolveOpencodeBinary(winInput(fs))).toBeNull();
    });
  });
});
