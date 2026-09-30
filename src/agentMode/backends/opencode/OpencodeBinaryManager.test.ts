import { waitFor } from "@testing-library/react";
jest.mock("obsidian", () => ({
  FileSystemAdapter: class {},
  requestUrl: jest.fn(),
  Platform: { isDesktopApp: true, isMobile: false },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("os", () => {
  const actual = jest.requireActual("os");
  return { ...actual, homedir: jest.fn(() => actual.homedir()) };
});

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

jest.mock("./opencodeCliDetector", () => ({
  detectOpencodeCliPath: jest.fn(async () => null),
}));

import { OPENCODE_MIN_VERSION, OPENCODE_PINNED_VERSION } from "./ui/opencodeVersion";
import * as fs from "node:fs";
import * as os from "os";
import * as path from "node:path";
import {
  computeInstallState,
  isOpencodeVersionOutdated,
  legacyVaultDataDir,
  opencodeManagedDataDir,
  OpencodeBinaryManager,
  OperationInFlightError,
  parseVersionFromStdout,
  toOpencodeInstallState,
  verifyOpencodeBinary,
} from "./OpencodeBinaryManager";

describe("OpencodeBinaryManager", () => {
  const settingsMock = jest.requireMock("@/settings/model");

  const fakePlugin = {
    app: { vault: { adapter: {} } },
    manifest: { id: "copilot-test" },
  } as never;

  const FileSystemAdapterMock = jest.requireMock("obsidian").FileSystemAdapter as new () => {
    getBasePath: () => string;
  };

  const CONFIG_DIR = "my-config";

  function vaultPlugin(vaultBase = "/vault", pluginId = "copilot-test"): never {
    const adapter = new FileSystemAdapterMock();
    adapter.getBasePath = () => vaultBase;
    return {
      app: { vault: { adapter, configDir: CONFIG_DIR } },
      manifest: { id: pluginId },
    } as never;
  }

  describe("isOpencodeVersionOutdated()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/569 rejects V1 and accepts the first supported V2 release", () => {
      expect(isOpencodeVersionOutdated("1.18.31")).toBe(true);
      expect(isOpencodeVersionOutdated("2.0.2")).toBe(true);
      expect(isOpencodeVersionOutdated("2.0.3")).toBe(false);
    });
  });

  describe("verifyOpencodeBinary()", () => {
    it("returns the trimmed --version output when the binary exits 0", async () => {
      const result = await verifyOpencodeBinary(process.execPath);
      expect(result.stdout).toMatch(/^v\d+\./);
    });

    it("rejects with No file at when the path does not exist", async () => {
      await expect(verifyOpencodeBinary("/definitely/not/a/real/path/opencode")).rejects.toThrow(
        /No file at/
      );
    });
  });

  describe("computeInstallState()", () => {
    it("returns absent when no binary path is set", () => {
      expect(computeInstallState({})).toEqual({ kind: "absent" });
      expect(computeInstallState(undefined)).toEqual({ kind: "absent" });
    });

    it("returns absent when the binary path has no file on disk", () => {
      expect(computeInstallState({ binaryPath: "/p" }, () => false)).toEqual({ kind: "absent" });
    });

    it("returns a managed install when settings have no binary source", () => {
      expect(computeInstallState({ binaryPath: "/p", binaryVersion: "1.2.3" }, () => true)).toEqual(
        {
          kind: "installed",
          version: "1.2.3",
          path: "/p",
          source: "managed",
        }
      );
    });

    it("returns the explicit binary source unchanged", () => {
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

    it("returns absent when a synced vault points at a binary missing on this device", () => {
      expect(
        computeInstallState({ binaryPath: "/p", binaryVersion: "1.2.3" }, () => false)
      ).toEqual({
        kind: "absent",
      });
    });
  });

  describe("toOpencodeInstallState()", () => {
    it("maps an absent install to absent and a minimum-version install to ready", () => {
      expect(toOpencodeInstallState({ kind: "absent" })).toEqual({ kind: "absent" });
      expect(
        toOpencodeInstallState({
          kind: "installed",
          version: OPENCODE_MIN_VERSION,
          path: "/p",
          source: "managed",
        })
      ).toEqual({ kind: "ready", source: "managed" });
    });

    it.each(["managed", "custom"] as const)(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/535 classifies %s installs as incompatible below the minimum, error for invalid metadata, and ready otherwise",
      (source) => {
        const classify = (version: string) =>
          toOpencodeInstallState({ kind: "installed", version, path: "/opencode", source });
        expect(classify("1.15.0")).toMatchObject({ kind: "incompatible", source });
        expect(classify(OPENCODE_MIN_VERSION)).toEqual({ kind: "ready", source });
        expect(classify(OPENCODE_PINNED_VERSION)).toEqual({ kind: "ready", source });
        expect(classify(OPENCODE_MIN_VERSION + "-beta.1").kind).toBe("incompatible");
        expect(classify("invalid").kind).toBe("error");
        expect(
          toOpencodeInstallState(computeInstallState({ binaryPath: "/opencode" }, () => true)).kind
        ).toBe("error");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/569 accepts a newer custom V2 binary while managed downloads stay pinned", () => {
      expect(
        toOpencodeInstallState({
          kind: "installed",
          version: "2.0.14",
          path: "/custom/opencode",
          source: "custom",
        })
      ).toEqual({ kind: "ready", source: "custom" });
    });
    it("describes an outdated install with its current version, minimum version, and message", () => {
      expect(
        toOpencodeInstallState({
          kind: "installed",
          version: "1.15.12",
          path: "/p",
          source: "custom",
        })
      ).toEqual({
        kind: "incompatible",
        source: "custom",
        currentVersion: "1.15.12",
        minVersion: OPENCODE_MIN_VERSION,
        message: `opencode v1.15.12 is not supported. Copilot requires opencode v${OPENCODE_MIN_VERSION} or newer.`,
      });
    });
  });

  describe("parseVersionFromStdout()", () => {
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

    it("returns undefined when the output has no semver token", () => {
      expect(parseVersionFromStdout("not a version")).toBeUndefined();
      expect(parseVersionFromStdout("")).toBeUndefined();
      expect(parseVersionFromStdout("1.2")).toBeUndefined();
    });
  });

  describe("opencodeManagedDataDir()", () => {
    afterEach(() => jest.mocked(os.homedir).mockReset());

    it("places the managed data dir under the home dir instead of the vault", () => {
      expect(opencodeManagedDataDir("/Users/me")).toBe(
        path.join("/Users/me", ".obsidian-copilot", "opencode")
      );
      expect(opencodeManagedDataDir("/Users/me")).not.toContain("plugins");
    });
  });

  describe("OpencodeBinaryManager", () => {
    describe("adoptPlugin()", () => {
      let home: string;

      beforeEach(async () => {
        home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-home-"));
        jest.mocked(os.homedir).mockReturnValue(home);
      });

      afterEach(async () => {
        jest.mocked(os.homedir).mockReset();
        await fs.promises.rm(home, { recursive: true, force: true });
      });

      it("reclaims from the adopted lifecycle's vault, not the one the manager was built with", async () => {
        const firstVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-vault-a-"));
        const secondVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-vault-b-"));
        try {
          const seedLegacy = async (vaultBase: string, bytes: number): Promise<string> => {
            const legacy = legacyVaultDataDir(vaultBase, CONFIG_DIR, "copilot-test");
            const bin = path.join(legacy, "1.14.0", "bin", "opencode");
            await fs.promises.mkdir(path.dirname(bin), { recursive: true });
            await fs.promises.writeFile(bin, "z".repeat(bytes));
            return legacy;
          };
          const firstLegacy = await seedLegacy(firstVault, 40);
          const secondLegacy = await seedLegacy(secondVault, 10);

          const mgr = new OpencodeBinaryManager(vaultPlugin(firstVault));
          mgr.adoptPlugin(vaultPlugin(secondVault));

          expect(await mgr.downloadsSize()).toBe(10);

          await mgr.uninstall();

          expect(fs.existsSync(secondLegacy)).toBe(false);
          expect(fs.existsSync(firstLegacy)).toBe(true);
        } finally {
          await fs.promises.rm(firstVault, { recursive: true, force: true });
          await fs.promises.rm(secondVault, { recursive: true, force: true });
        }
      });
    });

    describe("refreshInstallState()", () => {
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-mgr-"));
      });

      afterEach(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      });

      it("leaves settings empty when no binary is configured", async () => {
        settingsMock.__reset({});
        const mgr = new OpencodeBinaryManager(fakePlugin);
        await mgr.refreshInstallState();
        expect(settingsMock.__get()).toEqual({});
      });

      it("keeps a custom binary selection even when its file is missing", async () => {
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

      it("clears the selection when the persisted managed binary is missing on disk", async () => {
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

      it("keeps the selection when the persisted managed binary exists", async () => {
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

    describe("setCustomBinaryPath()", () => {
      let tmpDir: string;

      beforeEach(async () => {
        settingsMock.__reset({});
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-custom-"));
        jest.mocked(os.homedir).mockReturnValue(tmpDir);
      });

      afterEach(async () => {
        jest.mocked(os.homedir).mockReset();
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 selects a custom executable and removes managed and legacy downloads", async () => {
        const vaultBase = path.join(tmpDir, "vault");
        const mgr = new OpencodeBinaryManager(vaultPlugin(vaultBase));
        const legacy = legacyVaultDataDir(vaultBase, CONFIG_DIR, "copilot-test");
        fs.mkdirSync(mgr.getDataDir(), { recursive: true });
        fs.mkdirSync(legacy, { recursive: true });
        await mgr.setCustomBinaryPath(process.execPath);
        expect(fs.existsSync(mgr.getDataDir())).toBe(false);
        expect(fs.existsSync(legacy)).toBe(false);
        expect(fs.existsSync(process.execPath)).toBe(true);
        expect(settingsMock.__get().binarySource).toBe("custom");
      });

      it("records the --version output and custom source when a real binary is accepted", async () => {
        const mgr = new OpencodeBinaryManager(fakePlugin);
        await mgr.setCustomBinaryPath(process.execPath);
        const stored = settingsMock.__get();
        expect(stored.binaryPath).toBe(process.execPath);
        expect(stored.binarySource).toBe("custom");
        expect(stored.binaryVersion).toMatch(/^\d+\.\d+\.\d+/);
      });

      it("clears a previous error once the next operation succeeds", async () => {
        const mgr = new OpencodeBinaryManager(fakePlugin);
        await expect(mgr.setCustomBinaryPath("/definitely/not/here")).rejects.toThrow();

        await mgr.setCustomBinaryPath(process.execPath);

        expect(mgr.getRuntimeState()).toEqual({ kind: "idle" });
      });

      it("refuses a second operation while one holds the binary-path lock", async () => {
        const mgr = new OpencodeBinaryManager(fakePlugin);
        const first = mgr.setCustomBinaryPath(process.execPath);
        expect(mgr.isBusy()).toBe(true);

        await expect(mgr.setCustomBinaryPath(process.execPath)).rejects.toBeInstanceOf(
          OperationInFlightError
        );

        await first;
        expect(settingsMock.__get().binaryPath).toBe(process.execPath);
      });

      it("frees the lock once the operation settles, including on failure", async () => {
        const mgr = new OpencodeBinaryManager(fakePlugin);
        await expect(mgr.setCustomBinaryPath("/definitely/not/here")).rejects.toThrow();

        expect(mgr.isBusy()).toBe(false);
        await expect(mgr.setCustomBinaryPath(process.execPath)).resolves.toBeUndefined();
      });
    });

    describe("upgradeCustomBinary()", () => {
      let tmpDir: string;

      beforeEach(async () => {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-upgrade-"));
      });

      afterEach(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      });

      it.each(["upgrade", "--version"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/368 cancels during %s without publishing settings or Retry",
        async (phase) => {
          if (process.platform === "win32") return;
          const file = path.join(tmpDir, "opencode");
          const marker = path.join(tmpDir, "started");
          await fs.promises.writeFile(
            file,
            `#!${process.execPath}
if (process.argv[2] === ${JSON.stringify(phase)}) {
  require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
  setTimeout(() => process.stdout.write("99.0.0"), ${phase === "upgrade" ? 30000 : 250});
}
`
          );
          await fs.promises.chmod(file, 0o755);
          const initial = {
            binaryPath: file,
            binaryVersion: "1.0.0",
            binarySource: "custom" as const,
          };
          settingsMock.__reset(initial);
          const manager = new OpencodeBinaryManager(fakePlugin);
          const operation = manager.upgradeCustomBinary();
          const rejected = expect(operation).rejects.toMatchObject({ name: "AbortError" });
          try {
            await waitFor(() => expect(fs.existsSync(marker)).toBe(true));
            const pid = Number(await fs.promises.readFile(marker, "utf8"));
            manager.cancelCurrentOperation();
            await rejected;
            await waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
            expect(settingsMock.__get()).toEqual(initial);
            expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
          } finally {
            manager.cancelCurrentOperation();
            await operation.catch(() => undefined);
          }
        }
      );

      it("rejects and keeps settings when opencode upgrade exits successfully but leaves an outdated binary", async () => {
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
        await expect(mgr.upgradeCustomBinary()).rejects.toThrow(OPENCODE_MIN_VERSION);
        expect(settingsMock.__get()).toEqual({
          binaryPath: file,
          binaryVersion: "1.15.11",
          binarySource: "custom",
        });
      });
    });

    describe("getDataDir()", () => {
      afterEach(() => jest.mocked(os.homedir).mockReset());

      it("resolves to the managed data dir under the home dir", () => {
        jest.mocked(os.homedir).mockReturnValue("/Users/me");
        const mgr = new OpencodeBinaryManager(vaultPlugin());
        expect(mgr.getDataDir()).toBe(opencodeManagedDataDir("/Users/me"));
      });

      it.each([
        ["empty home", ""],
        ["filesystem root", path.parse(process.cwd()).root],
      ])("throws an actionable error when the home dir is unusable (%s)", (_label, badHome) => {
        jest.mocked(os.homedir).mockReturnValue(badHome);
        const mgr = new OpencodeBinaryManager(vaultPlugin());
        expect(() => mgr.getDataDir()).toThrow(/home directory/i);
      });
    });

    describe("uninstall()", () => {
      let home: string;

      beforeEach(async () => {
        home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-home-"));
        jest.mocked(os.homedir).mockReturnValue(home);
      });

      afterEach(async () => {
        jest.mocked(os.homedir).mockReset();
        await fs.promises.rm(home, { recursive: true, force: true });
      });

      it("counts and removes the pre-migration in-vault copy", async () => {
        const vaultBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-vault-"));
        try {
          const mgr = new OpencodeBinaryManager(vaultPlugin(vaultBase));
          const legacy = legacyVaultDataDir(vaultBase, CONFIG_DIR, "copilot-test");
          const legacyBin = path.join(legacy, "1.14.0", "bin", "opencode");
          await fs.promises.mkdir(path.dirname(legacyBin), { recursive: true });
          await fs.promises.writeFile(legacyBin, "z".repeat(40));
          settingsMock.__reset({
            binaryPath: legacyBin,
            binaryVersion: "1.14.0",
            binarySource: "managed",
          });

          expect(await mgr.downloadsSize()).toBe(40);

          await mgr.uninstall();

          expect(fs.existsSync(legacy)).toBe(false);
          expect(settingsMock.__get().binaryPath).toBeUndefined();
        } finally {
          await fs.promises.rm(vaultBase, { recursive: true, force: true });
        }
      });
    });
  });
});
