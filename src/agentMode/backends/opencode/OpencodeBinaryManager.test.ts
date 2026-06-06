jest.mock("obsidian", () => ({
  // pickMatchingAsset is pure; FileSystemAdapter and requestUrl are
  // referenced by the manager class but not by these tests.
  FileSystemAdapter: class {},
  requestUrl: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Override only homedir so tests can redirect the OS-local install root into a
// temp dir; tmpdir() and everything else stay real.
jest.mock("node:os", () => {
  const actual = jest.requireActual("node:os");
  return { ...actual, homedir: jest.fn(() => actual.homedir()) };
});

// In-memory settings store for the manager's getSettings/setSettings calls.
// Defined inside jest.mock so it's hoisted alongside the factory.
jest.mock("@/settings/model", () => {
  type OpencodeSlice = {
    binaryPath?: string;
    binaryVersion?: string;
    binarySource?: "managed" | "custom";
  };
  type AgentMode = {
    enabled?: boolean;
    activeBackend?: string;
    backends?: { opencode?: OpencodeSlice };
  };
  type Store = { agentMode: AgentMode };
  let store: Store = {
    agentMode: { backends: { opencode: {} } },
  };
  return {
    __esModule: true,
    __reset: (initial: OpencodeSlice = {}) => {
      store = { agentMode: { backends: { opencode: { ...initial } } } };
    },
    __get: () => store.agentMode.backends?.opencode ?? {},
    getSettings: () => store,
    setSettings: (settings: Partial<Store> | ((current: Store) => Partial<Store>)) => {
      const partial = typeof settings === "function" ? settings(store) : settings;
      store = { ...store, ...partial };
    },
  };
});

import { OPENCODE_MIN_ACP_VERSION, OPENCODE_PINNED_VERSION } from "@/constants";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeInstallState,
  opencodeManagedDataDir,
  OpencodeBinaryManager,
  parseVersionFromStdout,
  pickMatchingAsset,
  verifyOpencodeBinary,
} from "./OpencodeBinaryManager";

// Pull the mock helpers off the mocked module without TS complaints.
const settingsMock = jest.requireMock("@/settings/model");

// Minimal CopilotPlugin stand-in. Only `manifest.id` and `app.vault.adapter`
// are touched by the methods under test, and only via getDataDir() (which we
// don't exercise here).
const fakePlugin = {
  app: { vault: { adapter: {} } },
  manifest: { id: "copilot-test" },
} as never;

// The mocked FileSystemAdapter class, used to build a desktop-like plugin whose
// `adapter instanceof FileSystemAdapter` holds so getDataDir/legacy paths work.
const FileSystemAdapterMock = jest.requireMock("obsidian").FileSystemAdapter as new () => {
  getBasePath: () => string;
};

/**
 * A desktop CopilotPlugin stand-in whose vault adapter passes the
 * `instanceof FileSystemAdapter` guard so getDataDir() resolves.
 */
function vaultPlugin(pluginId = "copilot-test"): never {
  const adapter = new FileSystemAdapterMock();
  adapter.getBasePath = () => "/vault";
  return {
    app: { vault: { adapter } },
    manifest: { id: pluginId },
  } as never;
}

describe("pickMatchingAsset", () => {
  const release = {
    tag_name: `v${OPENCODE_PINNED_VERSION}`,
    assets: [
      {
        name: "opencode-darwin-arm64.zip",
        size: 100,
        browser_download_url: "https://example.com/opencode-darwin-arm64.zip",
      },
      {
        name: "opencode-linux-x64.tar.gz",
        size: 100,
        browser_download_url: "https://example.com/opencode-linux-x64.tar.gz",
      },
      {
        name: "opencode-linux-x64-musl.tar.gz",
        size: 100,
        browser_download_url: "https://example.com/opencode-linux-x64-musl.tar.gz",
      },
      {
        name: "opencode-windows-x64.zip",
        size: 100,
        browser_download_url: "https://example.com/opencode-windows-x64.zip",
      },
    ],
  };

  it("picks the first matching candidate stem", () => {
    const asset = pickMatchingAsset(release, ["opencode-darwin-arm64"]);
    expect(asset.name).toBe("opencode-darwin-arm64.zip");
  });

  it("falls back to the next candidate when the preferred one is missing", () => {
    const asset = pickMatchingAsset(release, [
      "opencode-linux-x64-musl-baseline",
      "opencode-linux-x64-musl",
      "opencode-linux-x64",
    ]);
    expect(asset.name).toBe("opencode-linux-x64-musl.tar.gz");
  });

  it("strips .tar.gz before matching stems", () => {
    const asset = pickMatchingAsset(release, ["opencode-linux-x64"]);
    expect(asset.name).toBe("opencode-linux-x64.tar.gz");
  });

  it("throws when no candidate matches", () => {
    expect(() => pickMatchingAsset(release, ["opencode-windows-arm64"])).toThrow(
      /No matching opencode release asset/
    );
  });
});

describe("verifyOpencodeBinary", () => {
  // We use the running Node binary as a stand-in for any executable that
  // accepts `--version` and exits 0. This exercises the success path without
  // requiring a real opencode binary on disk.
  it("resolves when the binary returns 0 to --version", async () => {
    const result = await verifyOpencodeBinary(process.execPath);
    expect(result.stdout).toMatch(/^v\d+\./);
  });

  it("throws ENOENT-style error for a non-existent path", async () => {
    await expect(verifyOpencodeBinary("/definitely/not/a/real/path/opencode")).rejects.toThrow(
      /No file at/
    );
  });
});

describe("computeInstallState", () => {
  it("absent when no path is set", () => {
    expect(computeInstallState({})).toEqual({ kind: "absent" });
    expect(computeInstallState(undefined)).toEqual({ kind: "absent" });
  });

  it("absent when path is set but version is missing", () => {
    // We no longer surface a path-only state — without a version we can't
    // tell what binary the user is pointing at, so the manager forces
    // install/setCustomBinaryPath to populate both fields together.
    expect(computeInstallState({ binaryPath: "/p" })).toEqual({ kind: "absent" });
  });

  it("installed (managed) when source is missing — legacy data defaults to managed", () => {
    expect(computeInstallState({ binaryPath: "/p", binaryVersion: "1.2.3" }, () => true)).toEqual({
      kind: "installed",
      version: "1.2.3",
      path: "/p",
      source: "managed",
    });
  });

  it("installed with explicit source preserves the value", () => {
    expect(
      computeInstallState(
        { binaryPath: "/p", binaryVersion: "1.2.3", binarySource: "custom" },
        () => true
      )
    ).toEqual({ kind: "installed", version: "1.2.3", path: "/p", source: "custom" });
    expect(
      computeInstallState(
        { binaryPath: "/p", binaryVersion: "1.2.3", binarySource: "managed" },
        () => true
      )
    ).toEqual({ kind: "installed", version: "1.2.3", path: "/p", source: "managed" });
  });

  it("absent when the configured binary is missing on this device (synced vault)", () => {
    // Fully-configured slice, but the file doesn't exist locally — e.g. the
    // vault synced from another device where opencode was installed (#123).
    expect(computeInstallState({ binaryPath: "/p", binaryVersion: "1.2.3" }, () => false)).toEqual({
      kind: "absent",
    });
  });
});

describe("parseVersionFromStdout", () => {
  const V = OPENCODE_PINNED_VERSION;
  it.each([
    [V, V],
    [`v${V}`, V],
    [`opencode ${V}`, V],
    [`opencode\nversion: ${V}\n`, V],
    [`${V}-rc.1`, `${V}-rc.1`],
    [`${V}+build.5`, `${V}+build.5`],
  ])("parses %j → %s", (input, expected) => {
    expect(parseVersionFromStdout(input)).toBe(expected);
  });

  it("returns undefined when no semver-shaped token is present", () => {
    expect(parseVersionFromStdout("not a version")).toBeUndefined();
    expect(parseVersionFromStdout("")).toBeUndefined();
    expect(parseVersionFromStdout("1.2")).toBeUndefined();
  });
});

describe("OpencodeBinaryManager.refreshInstallState", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-mgr-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("no-op for absent state", async () => {
    settingsMock.__reset({});
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.refreshInstallState();
    expect(settingsMock.__get()).toEqual({});
  });

  it("no-op for custom-source installs even if the file is missing", async () => {
    // Custom paths are validated at config time and shouldn't be re-checked
    // on every plugin load — a transient mount issue shouldn't wipe user state.
    const ghost = path.join(tmpDir, "does-not-exist", "opencode");
    settingsMock.__reset({
      binaryPath: ghost,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "custom",
    });
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.refreshInstallState();
    expect(settingsMock.__get()).toEqual({
      binaryPath: ghost,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "custom",
    });
  });

  it("clears settings when persisted managed binary is missing on disk", async () => {
    const ghost = path.join(tmpDir, "does-not-exist", "opencode");
    settingsMock.__reset({
      binaryPath: ghost,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "managed",
    });
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.refreshInstallState();
    expect(settingsMock.__get()).toEqual({
      binaryPath: undefined,
      binaryVersion: undefined,
      binarySource: undefined,
    });
  });

  it("leaves settings intact when persisted managed binary is present", async () => {
    const realFile = path.join(tmpDir, "opencode");
    await fs.promises.writeFile(realFile, "");
    settingsMock.__reset({
      binaryPath: realFile,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "managed",
    });
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.refreshInstallState();
    expect(settingsMock.__get()).toEqual({
      binaryPath: realFile,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "managed",
    });
  });
});

describe("OpencodeBinaryManager.setCustomBinaryPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    settingsMock.__reset({});
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-custom-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects when the file does not exist", async () => {
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await expect(mgr.setCustomBinaryPath(path.join(tmpDir, "nope"))).rejects.toThrow(/No file at/);
    expect(settingsMock.__get()).toEqual({});
  });

  it("rejects when the path is a directory, not a file", async () => {
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await expect(mgr.setCustomBinaryPath(tmpDir)).rejects.toThrow(/No file at/);
    expect(settingsMock.__get()).toEqual({});
  });

  it("rejects non-executable files on POSIX", async () => {
    if (process.platform === "win32") return; // skip — XOK semantics differ on Windows
    const file = path.join(tmpDir, "not-exec");
    await fs.promises.writeFile(file, "");
    await fs.promises.chmod(file, 0o644);
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await expect(mgr.setCustomBinaryPath(file)).rejects.toThrow(/not executable/);
    expect(settingsMock.__get()).toEqual({});
  });

  it("clearing (null) wipes all binary fields and does not touch disk", async () => {
    settingsMock.__reset({
      binaryPath: "/p",
      binaryVersion: "1.0.0",
      binarySource: "managed",
    });
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.setCustomBinaryPath(null);
    expect(settingsMock.__get()).toEqual({
      binaryPath: undefined,
      binaryVersion: undefined,
      binarySource: undefined,
    });
  });

  it("accepting a real binary captures version from --version and tags source as custom", async () => {
    // Use the running node binary as a stand-in: it exists, is executable,
    // and `--version` exits 0 — the same shape verifyOpencodeBinary expects.
    // Node prints `v22.x.y`; the parser strips the `v` and gives us a semver.
    const mgr = new OpencodeBinaryManager(fakePlugin);
    await mgr.setCustomBinaryPath(process.execPath);
    const stored = settingsMock.__get();
    expect(stored.binaryPath).toBe(process.execPath);
    expect(stored.binarySource).toBe("custom");
    expect(stored.binaryVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("OpencodeBinaryManager.upgradeCustomBinary", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-upgrade-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects when opencode upgrade exits successfully but leaves an outdated binary", async () => {
    if (process.platform === "win32") return;
    const file = path.join(tmpDir, "opencode");
    await fs.promises.writeFile(
      file,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.15.11"
  exit 0
fi
if [ "$1" = "upgrade" ]; then
  echo "Upgrade failed" >&2
  exit 0
fi
`
    );
    await fs.promises.chmod(file, 0o755);
    settingsMock.__reset({
      binaryPath: file,
      binaryVersion: "1.15.11",
      binarySource: "custom",
    });

    const mgr = new OpencodeBinaryManager(fakePlugin);
    await expect(mgr.upgradeCustomBinary()).rejects.toThrow(OPENCODE_MIN_ACP_VERSION);
    expect(settingsMock.__get()).toEqual({
      binaryPath: file,
      binaryVersion: "1.15.11",
      binarySource: "custom",
    });
  });
});

describe("install-dir paths (outside the vault)", () => {
  afterEach(() => jest.mocked(os.homedir).mockReset());

  it("opencodeManagedDataDir is under the home dir, not the vault", () => {
    expect(opencodeManagedDataDir("/Users/me")).toBe(
      path.join("/Users/me", ".obsidian-copilot", "opencode")
    );
    // Sanity: nothing about the path references the vault/plugin data dir.
    expect(opencodeManagedDataDir("/Users/me")).not.toContain("plugins");
  });

  it("getDataDir resolves to the home-dir location, not the vault", () => {
    jest.mocked(os.homedir).mockReturnValue("/Users/me");
    const mgr = new OpencodeBinaryManager(vaultPlugin());
    expect(mgr.getDataDir()).toBe(opencodeManagedDataDir("/Users/me"));
  });
});
