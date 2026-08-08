import { resolveNodeToolBinDirs } from "@/utils/nodeToolBinDirs";
import type { NodeToolBinDirsInput, NodeToolFs } from "@/utils/nodeToolBinDirs";

/**
 * Fake fs: `dirs` are the directories that exist (`existsSync`), `files` maps
 * a readable file path to its contents (`readFileSync`), and `listings` maps a
 * directory to its `readdirSync` entries. Anything unlisted throws ENOENT,
 * mirroring real `fs`.
 */
function makeFs(opts: {
  dirs?: Iterable<string>;
  files?: Record<string, string>;
  listings?: Record<string, string[]>;
}): NodeToolFs {
  const dirs = new Set(opts.dirs ?? []);
  const files = opts.files ?? {};
  const listings = opts.listings ?? {};
  return {
    existsSync: (p) => dirs.has(p),
    readFileSync: (p) => {
      if (p in files) return files[p];
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
    readdirSync: (p) => {
      if (p in listings) return listings[p];
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

function unixInput(overrides: Partial<NodeToolBinDirsInput> = {}): NodeToolBinDirsInput {
  return {
    homeDir: "/home/me",
    platform: "linux",
    env: {},
    fs: makeFs({}),
    ...overrides,
  };
}

describe("resolveNodeToolBinDirs (unix)", () => {
  test("returns NVM_BIN when set and present", () => {
    const dir = "/home/me/.nvm/versions/node/v20.18.0/bin";
    const dirs = resolveNodeToolBinDirs(
      unixInput({ env: { NVM_BIN: dir }, fs: makeFs({ dirs: [dir] }) })
    );
    expect(dirs).toContain(dir);
  });

  test("resolves the nvm default alias to its version's bin dir", () => {
    const versions = "/home/me/.nvm/versions/node";
    const v20 = `${versions}/v20.18.0/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        fs: makeFs({
          dirs: [v20, `${versions}/v18.20.0/bin`],
          files: { "/home/me/.nvm/alias/default": "20\n" },
          listings: { [versions]: ["v18.20.0", "v20.18.0"] },
        }),
      })
    );
    expect(dirs).toContain(v20);
  });

  test("follows nvm alias chains (default -> lts/* -> version)", () => {
    const versions = "/home/me/.nvm/versions/node";
    const v18 = `${versions}/v18.20.0/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        fs: makeFs({
          dirs: [v18],
          files: {
            "/home/me/.nvm/alias/default": "lts/*",
            "/home/me/.nvm/alias/lts/*": "lts/hydrogen",
            "/home/me/.nvm/alias/lts/hydrogen": "v18.20.0",
          },
          listings: { [versions]: ["v18.20.0"] },
        }),
      })
    );
    expect(dirs).toContain(v18);
  });

  test("enumerates every installed nvm version newest-first, default first", () => {
    const versions = "/home/me/.nvm/versions/node";
    const v18 = `${versions}/v18.20.0/bin`;
    const v20 = `${versions}/v20.18.0/bin`;
    const v22 = `${versions}/v22.1.0/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        fs: makeFs({
          dirs: [v18, v20, v22],
          files: { "/home/me/.nvm/alias/default": "18" },
          listings: { [versions]: ["v18.20.0", "v20.18.0", "v22.1.0"] },
        }),
      })
    );
    // Default (v18) wins, then the rest sorted newest-first.
    expect(dirs).toEqual([v18, v22, v20]);
  });

  test("ignores an unparseable nvm default alias but still enumerates versions", () => {
    const versions = "/home/me/.nvm/versions/node";
    const v20 = `${versions}/v20.18.0/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        fs: makeFs({
          dirs: [v20],
          files: { "/home/me/.nvm/alias/default": "lts/argon" }, // not installed
          listings: { [versions]: ["v20.18.0"] },
        }),
      })
    );
    expect(dirs).toEqual([v20]);
  });

  test("honors $NVM_DIR over the default ~/.nvm location", () => {
    const versions = "/opt/nvm/versions/node";
    const v20 = `${versions}/v20.18.0/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        env: { NVM_DIR: "/opt/nvm" },
        fs: makeFs({ dirs: [v20], listings: { [versions]: ["v20.18.0"] } }),
      })
    );
    expect(dirs).toContain(v20);
  });

  test("finds fnm's active multishell bin", () => {
    const bin = "/run/fnm/abc/bin";
    const dirs = resolveNodeToolBinDirs(
      unixInput({ env: { FNM_MULTISHELL_PATH: "/run/fnm/abc" }, fs: makeFs({ dirs: [bin] }) })
    );
    expect(dirs).toContain(bin);
  });

  test("enumerates fnm node-versions under the macOS base dir", () => {
    const base = "/home/me/Library/Application Support/fnm/node-versions";
    const v20 = `${base}/v20.18.0/installation/bin`;
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        platform: "darwin",
        fs: makeFs({ dirs: [v20], listings: { [base]: ["v20.18.0"] } }),
      })
    );
    expect(dirs).toContain(v20);
  });

  test("finds asdf shims, Volta, n, and npm_config_prefix bins", () => {
    const shims = "/home/me/.asdf/shims";
    const volta = "/home/me/.volta/bin";
    const nbin = "/usr/local/n/bin";
    const npmPrefix = "/home/me/.npm-global/custom/bin";
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        env: { N_PREFIX: "/usr/local/n", npm_config_prefix: "/home/me/.npm-global/custom" },
        fs: makeFs({ dirs: [shims, volta, nbin, npmPrefix] }),
      })
    );
    expect(dirs).toEqual(expect.arrayContaining([shims, volta, nbin, npmPrefix]));
  });

  test("prefers an existing ~/.asdf data dir over an ASDF_DIR install path", () => {
    // Homebrew-style: ASDF_DIR points at the install dir, shims stay under the
    // default ~/.asdf data dir. The install dir has no shims/bin of its own.
    const shims = "/home/me/.asdf/shims";
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        env: { ASDF_DIR: "/opt/homebrew/opt/asdf/libexec" },
        fs: makeFs({ dirs: [shims] }),
      })
    );
    expect(dirs).toContain(shims);
  });

  test("honors ASDF_DATA_DIR over both ~/.asdf and ASDF_DIR", () => {
    const shims = "/custom/asdf/shims";
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        env: { ASDF_DATA_DIR: "/custom/asdf", ASDF_DIR: "/opt/homebrew/opt/asdf/libexec" },
        fs: makeFs({ dirs: [shims, "/home/me/.asdf/shims"] }),
      })
    );
    expect(dirs).toContain(shims);
  });

  test("falls back to ASDF_DIR shims when no ~/.asdf data dir exists", () => {
    const shims = "/opt/asdf/shims";
    const dirs = resolveNodeToolBinDirs(
      unixInput({
        env: { ASDF_DIR: "/opt/asdf" },
        fs: makeFs({ dirs: [shims] }),
      })
    );
    expect(dirs).toContain(shims);
  });

  test("drops candidate dirs that do not exist", () => {
    const dirs = resolveNodeToolBinDirs(
      unixInput({ env: { VOLTA_HOME: "/home/me/.volta" }, fs: makeFs({ dirs: [] }) })
    );
    expect(dirs).toEqual([]);
  });

  test("~/.local/bin is included when present", () => {
    const local = "/home/me/.local/bin";
    const dirs = resolveNodeToolBinDirs(unixInput({ fs: makeFs({ dirs: [local] }) }));
    expect(dirs).toContain(local);
  });
});

describe("resolveNodeToolBinDirs (windows)", () => {
  function winInput(overrides: Partial<NodeToolBinDirsInput> = {}): NodeToolBinDirsInput {
    return {
      homeDir: "C:\\Users\\me",
      platform: "win32",
      env: {},
      fs: makeFs({}),
      ...overrides,
    };
  }

  test("finds the npm global dir under %APPDATA%", () => {
    const npm = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const dirs = resolveNodeToolBinDirs(
      winInput({ env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, fs: makeFs({ dirs: [npm] }) })
    );
    expect(dirs).toContain(npm);
  });

  test("finds the nvm-windows symlink dir", () => {
    const symlink = "C:\\nvm4w\\nodejs";
    const dirs = resolveNodeToolBinDirs(
      winInput({ env: { NVM_SYMLINK: symlink }, fs: makeFs({ dirs: [symlink] }) })
    );
    expect(dirs).toContain(symlink);
  });
});
