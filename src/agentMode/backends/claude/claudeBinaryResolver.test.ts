import {
  resolveClaudeBinary,
  type ClaudeBinaryResolverFs,
  type ClaudeBinaryResolverInput,
} from "./claudeBinaryResolver";

function makeFs(
  paths: Iterable<string>,
  contents: Record<string, string> = {}
): ClaudeBinaryResolverFs {
  const set = new Set(paths);
  return {
    existsSync: (p: string) => set.has(p),
    readFileSync: (p: string) => {
      if (p in contents) return contents[p];
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

function unixInput(
  fs: ClaudeBinaryResolverFs,
  overrides: Partial<ClaudeBinaryResolverInput> = {}
): ClaudeBinaryResolverInput {
  return {
    homeDir: "/home/me",
    platform: "linux",
    env: {},
    fs,
    ...overrides,
  };
}

function winInput(
  fs: ClaudeBinaryResolverFs,
  overrides: Partial<ClaudeBinaryResolverInput> = {}
): ClaudeBinaryResolverInput {
  return {
    homeDir: "C:\\Users\\me",
    platform: "win32",
    env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
    fs,
    ...overrides,
  };
}

describe("resolveClaudeBinary — Unix", () => {
  it("returns the override when it exists", () => {
    const fs = makeFs(["/custom/claude"]);
    const path = resolveClaudeBinary(unixInput(fs, { override: "/custom/claude" }));
    expect(path).toBe("/custom/claude");
  });

  it("falls through to the default search when the override is missing", () => {
    const fs = makeFs(["/home/me/.claude/local/claude"]);
    const path = resolveClaudeBinary(unixInput(fs, { override: "/missing" }));
    expect(path).toBe("/home/me/.claude/local/claude");
  });

  it("prefers ~/.claude/local/claude over later candidates", () => {
    const fs = makeFs([
      "/home/me/.claude/local/claude",
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ]);
    expect(resolveClaudeBinary(unixInput(fs))).toBe("/home/me/.claude/local/claude");
  });

  it("finds /opt/homebrew/bin/claude when no earlier candidate exists", () => {
    const fs = makeFs(["/opt/homebrew/bin/claude"]);
    expect(resolveClaudeBinary(unixInput(fs))).toBe("/opt/homebrew/bin/claude");
  });

  it("finds ~/.volta/bin/claude", () => {
    const fs = makeFs(["/home/me/.volta/bin/claude"]);
    expect(resolveClaudeBinary(unixInput(fs))).toBe("/home/me/.volta/bin/claude");
  });

  it("finds ~/.asdf/shims/claude", () => {
    const fs = makeFs(["/home/me/.asdf/shims/claude"]);
    expect(resolveClaudeBinary(unixInput(fs))).toBe("/home/me/.asdf/shims/claude");
  });

  it("uses npm_config_prefix when set", () => {
    const fs = makeFs(["/opt/myprefix/bin/claude"]);
    const path = resolveClaudeBinary(
      unixInput(fs, { env: { npm_config_prefix: "/opt/myprefix" } })
    );
    expect(path).toBe("/opt/myprefix/bin/claude");
  });

  it("falls back to NVM default alias when no other candidate exists", () => {
    const aliasPath = "/home/me/.nvm/alias/default";
    const claudePath = "/home/me/.nvm/versions/node/v20.11.0/bin/claude";
    const fs = makeFs([aliasPath, claudePath], { [aliasPath]: "v20.11.0\n" });
    expect(resolveClaudeBinary(unixInput(fs))).toBe(claudePath);
  });

  it("accepts NVM alias contents without the leading 'v'", () => {
    const aliasPath = "/home/me/.nvm/alias/default";
    const claudePath = "/home/me/.nvm/versions/node/v18.19.0/bin/claude";
    const fs = makeFs([aliasPath, claudePath], { [aliasPath]: "18.19.0" });
    expect(resolveClaudeBinary(unixInput(fs))).toBe(claudePath);
  });

  it("returns null when NVM alias is unparseable (e.g. 'lts/*')", () => {
    const aliasPath = "/home/me/.nvm/alias/default";
    const fs = makeFs([aliasPath], { [aliasPath]: "lts/*" });
    expect(resolveClaudeBinary(unixInput(fs))).toBeNull();
  });

  it("falls back to cli.js under the npm-global lib root", () => {
    const fs = makeFs(["/home/me/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js"]);
    expect(resolveClaudeBinary(unixInput(fs))).toBe(
      "/home/me/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js"
    );
  });

  it("returns null when nothing is found", () => {
    const fs = makeFs([]);
    expect(resolveClaudeBinary(unixInput(fs))).toBeNull();
  });
});

describe("resolveClaudeBinary — Windows", () => {
  it("prefers claude.exe over claude.cmd in the same dir", () => {
    const fs = makeFs([
      "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
    ]);
    expect(resolveClaudeBinary(winInput(fs))).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe"
    );
  });

  it("never picks claude.cmd even when it is the only file present", () => {
    const fs = makeFs(["C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd"]);
    expect(resolveClaudeBinary(winInput(fs))).toBeNull();
  });

  it("falls back to cli.js under node_modules\\@anthropic-ai\\claude-code", () => {
    const cliJs =
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js";
    const fs = makeFs([cliJs]);
    expect(resolveClaudeBinary(winInput(fs))).toBe(cliJs);
  });

  it("respects the override on Windows", () => {
    const override = "C:\\tools\\claude.exe";
    const fs = makeFs([override]);
    expect(resolveClaudeBinary(winInput(fs, { override }))).toBe(override);
  });
});
