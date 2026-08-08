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

describe("resolveOpencodeBinary — Unix", () => {
  it("returns the override when it exists", () => {
    const fs = makeFs(["/custom/opencode"]);
    expect(resolveOpencodeBinary(unixInput(fs, { override: "/custom/opencode" }))).toBe(
      "/custom/opencode"
    );
  });

  it("ignores a stale override (e.g. cross-OS sync) and falls back to detection", () => {
    // The bug this resolver guards against: a user's settings sync pulls in
    // a POSIX override path onto Windows, or vice versa. The override doesn't
    // exist on the new platform, so the resolver must keep walking.
    const native = "/home/me/.opencode/bin/opencode";
    const fs = makeFs([native]);
    expect(
      resolveOpencodeBinary(
        unixInput(fs, { override: "C:\\Users\\someone\\.opencode\\bin\\opencode.exe" })
      )
    ).toBe(native);
  });

  it("finds the native installer at ~/.opencode/bin/opencode", () => {
    const fs = makeFs(["/home/me/.opencode/bin/opencode"]);
    expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.opencode/bin/opencode");
  });

  it("finds the bun install at ~/.bun/bin/opencode", () => {
    const fs = makeFs(["/home/me/.bun/bin/opencode"]);
    expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.bun/bin/opencode");
  });

  it("finds /opt/homebrew/bin/opencode via WELL_KNOWN_BIN_DIRS", () => {
    const fs = makeFs(["/opt/homebrew/bin/opencode"]);
    expect(resolveOpencodeBinary(unixInput(fs))).toBe("/opt/homebrew/bin/opencode");
  });

  it("prefers ~/.opencode/bin/opencode over later candidates", () => {
    const fs = makeFs(["/home/me/.opencode/bin/opencode", "/usr/local/bin/opencode"]);
    expect(resolveOpencodeBinary(unixInput(fs))).toBe("/home/me/.opencode/bin/opencode");
  });

  it("returns null when nothing is found", () => {
    expect(resolveOpencodeBinary(unixInput(makeFs([])))).toBeNull();
  });
});

describe("resolveOpencodeBinary — Windows", () => {
  it("returns the override when it exists", () => {
    const override = "C:\\tools\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([override]), { override }))).toBe(override);
  });

  it("ignores a POSIX override synced from another OS", () => {
    // Concrete repro: settings sync brings `/Users/<them>/.opencode/bin/opencode`
    // from a macOS install onto a Windows machine where a native opencode
    // exists. Auto-detect must skip the dead POSIX path and find the local
    // .exe instead.
    const native = "C:\\Users\\me\\.opencode\\bin\\opencode.exe";
    expect(
      resolveOpencodeBinary(
        winInput(makeFs([native]), { override: "/Users/them/.opencode/bin/opencode" })
      )
    ).toBe(native);
  });

  it("finds the native installer at ~/.opencode/bin/opencode.exe", () => {
    const p = "C:\\Users\\me\\.opencode\\bin\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("finds the bun-global install at ~/.bun/bin/opencode.exe", () => {
    const p = "C:\\Users\\me\\.bun\\bin\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("finds ~/.local/bin/opencode.exe", () => {
    const p = "C:\\Users\\me\\.local\\bin\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("finds %LOCALAPPDATA%\\opencode\\bin\\opencode.exe via env var", () => {
    const p = "D:\\AppData\\Local\\opencode\\bin\\opencode.exe";
    expect(
      resolveOpencodeBinary(winInput(makeFs([p]), { env: { LOCALAPPDATA: "D:\\AppData\\Local" } }))
    ).toBe(p);
  });

  it("falls back to <homeDir>\\AppData\\Local\\opencode\\bin when LOCALAPPDATA is unset", () => {
    const p = "C:\\Users\\me\\AppData\\Local\\opencode\\bin\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("finds %ProgramFiles%\\opencode\\bin\\opencode.exe", () => {
    const p = "C:\\Program Files\\opencode\\bin\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("finds opencode.exe under %APPDATA%\\npm (node-tool bin dir)", () => {
    const p = "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe";
    expect(resolveOpencodeBinary(winInput(makeFs([p])))).toBe(p);
  });

  it("never picks opencode.cmd even when it is the only file present", () => {
    const fs = makeFs(["C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd"]);
    expect(resolveOpencodeBinary(winInput(fs))).toBeNull();
  });
});
