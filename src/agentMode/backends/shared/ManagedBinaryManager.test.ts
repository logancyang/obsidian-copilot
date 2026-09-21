import {
  ManagedBinaryManager,
  type BinarySettings,
  type InstalledBinary,
  type ManagedBinaryInstallOptions,
} from "@/agentMode/backends/shared/ManagedBinaryManager";
import {
  ManagedInstallAbortError,
  ManagedInstallOperationInFlightError,
} from "@/agentMode/backends/shared/managedInstall";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

class TestBinaryManager extends ManagedBinaryManager<number> {
  settings: BinarySettings = {};
  validate = jest.fn(async (binaryPath: string) => ({ version: "1.2.3", path: binaryPath }));
  pipeline = jest.fn(
    async (options: ManagedBinaryInstallOptions<number> & { signal: AbortSignal }) => {
      options.onProgress?.(50);
      this.selectInstalledBinary({
        binaryVersion: "1.2.3",
        binaryPath: "/managed/binary",
        binarySource: "managed",
      });
      return { version: "1.2.3", path: "/managed/binary" };
    }
  );

  constructor(private dataDir: string) {
    super("Test agent");
  }
  getDataDir(): string {
    return this.dataDir;
  }
  protected managedEntryPath(dir: string): string {
    return path.join(dir, "binary");
  }
  protected readBinarySettings(): BinarySettings {
    return this.settings;
  }
  protected updateBinarySettings(settings: BinarySettings): void {
    this.settings = settings;
  }
  protected validateCustomBinary(binaryPath: string): Promise<InstalledBinary> {
    return this.validate(binaryPath);
  }
  protected installPipeline(
    options: ManagedBinaryInstallOptions<number> & { signal: AbortSignal }
  ): Promise<InstalledBinary> {
    return this.pipeline(options);
  }
}

describe("ManagedBinaryManager", () => {
  describe("ManagedBinaryManager", () => {
    let tempDir: string;
    let manager: TestBinaryManager;
    let customPath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-binary-test-"));
      manager = new TestBinaryManager(path.join(tempDir, "managed"));
      customPath = path.join(tempDir, "custom-binary");
      fs.writeFileSync(customPath, "binary", { mode: 0o755 });
    });
    afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    describe("ensureManagedInstalled()", () => {
      const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/536";
      beforeEach(() => {
        manager.settings = {
          binaryPath: path.join(tempDir, "missing"),
          binaryVersion: "1.2.3",
          binarySource: "managed",
        };
      });
      it.each(["1.2.3", "0.9.0"])(
        `${issue} restores a missing selection regardless of recorded version %s`,
        async (version) => {
          manager.settings.binaryVersion = version;
          await manager.ensureManagedInstalled("1.2.3");
          expect(manager.settings.binaryPath).toBe("/managed/binary");
          expect(manager.pipeline.mock.calls[0][0]).toMatchObject({ preserveExisting: true });
        }
      );
      it(`${issue} coalesces concurrent recovery requests`, async () => {
        await Promise.all([
          manager.ensureManagedInstalled("1.2.3"),
          manager.ensureManagedInstalled("1.2.3"),
        ]);
        expect(manager.pipeline).toHaveBeenCalledTimes(1);
      });
      it(`${issue} reuses a verified exact version without deleting a higher cached version`, async () => {
        const root = manager.getDataDir();
        fs.mkdirSync(path.join(root, "1.2.3-copy"), { recursive: true });
        fs.mkdirSync(path.join(root, "2.0.0"));
        fs.writeFileSync(path.join(root, "1.2.3-copy", "binary"), "cached");
        fs.writeFileSync(path.join(root, "2.0.0", "binary"), "higher");
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.settings.binaryPath).toBe(path.join(root, "1.2.3-copy", "binary"));
        expect(manager.pipeline).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(root, "2.0.0", "binary"), "utf8")).toBe("higher");
      });
      it(`${issue} preserves the missing selection and exposes retry after download failure`, async () => {
        const previous = manager.settings;
        manager.pipeline.mockRejectedValueOnce(new Error("offline"));
        await expect(manager.ensureManagedInstalled("1.2.3")).rejects.toThrow("offline");
        expect(manager.settings).toEqual(previous);
        expect(manager.getRuntimeState()).toMatchObject({ kind: "error", operation: "install" });
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.settings.binaryPath).toBe("/managed/binary");
      });
      it(`${issue} preserves a custom selection made during recovery`, async () => {
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        manager.validate.mockImplementation(async (binaryPath) => {
          await pending;
          return { version: "1.2.3", path: binaryPath };
        });
        fs.mkdirSync(path.join(manager.getDataDir(), "1.2.3"), { recursive: true });
        const recovery = manager.ensureManagedInstalled("1.2.3");
        manager.settings = { binaryPath: customPath, binarySource: "custom" };
        release();
        await expect(recovery).rejects.toBeInstanceOf(ManagedInstallAbortError);
        expect(manager.settings.binaryPath).toBe(customPath);
        expect(manager.pipeline).not.toHaveBeenCalled();
      });
      it(`${issue} leaves corrupt and wrong-version cache entries intact and downloads a fresh installation`, async () => {
        fs.mkdirSync(path.join(manager.getDataDir(), "1.2.3"), { recursive: true });
        fs.writeFileSync(path.join(manager.getDataDir(), "1.2.3", "binary"), "wrong");
        manager.validate.mockResolvedValueOnce({ version: "2.0.0", path: "unused" });
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.pipeline).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(path.join(manager.getDataDir(), "1.2.3", "binary"), "utf8")).toBe(
          "wrong"
        );
      });
      it(`${issue} bypasses an automatic upgrade cooldown when the selected file is missing`, async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        fs.writeFileSync(
          path.join(manager.getDataDir(), "auto-upgrade-failure.json"),
          JSON.stringify({ pin: "1.2.3", failedAt: Date.now() })
        );
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.settings.binaryPath).toBe("/managed/binary");
      });
      it(`${issue} never recovers a custom selection or first install`, async () => {
        manager.settings.binarySource = "custom";
        await manager.ensureManagedInstalled("1.2.3");
        manager.settings = {};
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.pipeline).not.toHaveBeenCalled();
      });
      it(`${issue} leaves a working old runtime selected for the background updater`, async () => {
        manager.settings.binaryPath = customPath;
        manager.settings.binaryVersion = "1.0.0";
        await manager.ensureManagedInstalled("1.2.3");
        expect(manager.pipeline).not.toHaveBeenCalled();
        expect(manager.settings.binaryVersion).toBe("1.0.0");
      });
    });

    describe("autoUpgrade()", () => {
      const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/530";
      beforeEach(() => {
        manager.settings = {
          binaryPath: customPath,
          binaryVersion: "1.0.0",
          binarySource: "managed",
        };
      });
      it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/535 rejects a shipped pin below the minimum before downloading`, async () => {
        await expect(manager.autoUpgrade("1.0.0", "2.0.0", () => true, jest.fn())).rejects.toThrow(
          "requires"
        );
        expect(manager.pipeline).not.toHaveBeenCalled();
      });
      it.each([undefined, "0.9.0"])(
        `https://github.com/Brevilabs/obsidian-copilot-private/issues/535 retries legacy or previous-minimum cooldown %s`,
        async (minimumVersion) => {
          fs.mkdirSync(manager.getDataDir(), { recursive: true });
          fs.writeFileSync(
            path.join(manager.getDataDir(), "auto-upgrade-failure.json"),
            JSON.stringify({ pin: "2.0.0", minimumVersion, failedAt: Date.now() })
          );
          await manager.autoUpgrade("2.0.0", "1.1.0", () => true, jest.fn());
          expect(manager.pipeline).toHaveBeenCalledTimes(1);
        }
      );
      it.each(["2.0.0", "0.9.0"])(
        `${issue} follows a changed pin in either direction and emits one success`,
        async (pin) => {
          const notify = jest.fn();
          await manager.autoUpgrade(pin, "0.8.0", () => true, notify);
          expect(manager.pipeline).toHaveBeenCalledTimes(1);
          expect(manager.pipeline.mock.calls[0][0]).toMatchObject({ preserveExisting: true });
          expect(notify).toHaveBeenCalledTimes(1);
          expect(notify.mock.calls[0][0]).toContain("updated");
        }
      );
      it.each(["equal", "custom", "absent", "session"])(
        `${issue} skips %s without a notice`,
        async (reason) => {
          if (reason === "custom") manager.settings.binarySource = "custom";
          if (reason === "absent") manager.settings = {};
          const notify = jest.fn();
          await manager.autoUpgrade(
            reason === "equal" ? "1.0.0" : "2.0.0",
            "1.0.0",
            () => reason !== "session",
            notify
          );
          expect(manager.pipeline).not.toHaveBeenCalled();
          expect(notify).not.toHaveBeenCalled();
        }
      );
      it(`${issue} does not replace a custom selection written during download`, async () => {
        const pipeline = manager.pipeline.getMockImplementation()!;
        manager.pipeline.mockImplementation(async (options) => {
          manager.settings = {
            binaryPath: customPath,
            binaryVersion: "9.0.0",
            binarySource: "custom",
          };
          return pipeline(options);
        });
        await manager.autoUpgrade("2.0.0", "1.0.0", () => true, jest.fn());
        expect(manager.settings).toEqual({
          binaryPath: customPath,
          binaryVersion: "9.0.0",
          binarySource: "custom",
        });
      });
      it(`${issue} skips a second simultaneous load instead of duplicating its download`, async () => {
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const pipeline = manager.pipeline.getMockImplementation()!;
        manager.pipeline.mockImplementation(async (options) => {
          await pending;
          return pipeline(options);
        });
        const notify = jest.fn();
        const first = manager.autoUpgrade("2.0.0", "1.0.0", () => true, notify);
        await manager.autoUpgrade("2.0.0", "1.0.0", () => true, notify);
        finish();
        await first;
        expect(manager.pipeline).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
      });
      it(`${issue} persists offline cooldown across manager lifecycles while preserving the selected binary`, async () => {
        const original = { ...manager.settings };
        manager.pipeline.mockRejectedValue(new Error("offline"));
        const notify = jest.fn();
        await manager.autoUpgrade("2.0.0", "1.0.0", () => true, notify);
        expect(manager.settings).toEqual(original);
        expect(notify).toHaveBeenCalledTimes(1);
        const reopened = new TestBinaryManager(manager.getDataDir());
        reopened.settings = original;
        await reopened.autoUpgrade("2.0.0", "1.0.0", () => true, notify);
        expect(reopened.pipeline).not.toHaveBeenCalled();
        const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1);
        await reopened.autoUpgrade("2.0.0", "1.0.0", () => true, notify);
        expect(reopened.pipeline).toHaveBeenCalledTimes(1);
        now.mockRestore();
      });
    });
    describe("getRuntimeState()", () => {
      it("keeps the idle snapshot stable between reads", () => {
        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
        expect(manager.getRuntimeState()).toBe(manager.getRuntimeState());
      });
    });
    describe("subscribeRuntimeState()", () => {
      it("publishes operation changes until unsubscribed", async () => {
        const listener = jest.fn();
        const unsubscribe = manager.subscribeRuntimeState(listener);
        await manager.setCustomBinaryPath(null);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        await manager.setCustomBinaryPath(null);
        expect(listener).toHaveBeenCalledTimes(2);
      });
    });
    describe("install()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 publishes backend progress, returns the installation, and ignores progress after completion", async () => {
        const progress = jest.fn();
        const snapshots: unknown[] = [];
        manager.subscribeRuntimeState(() => snapshots.push(manager.getRuntimeState()));
        await expect(manager.install({ onProgress: progress })).resolves.toEqual({
          version: "1.2.3",
          path: "/managed/binary",
        });
        expect(progress).toHaveBeenCalledWith(50);
        const idle = manager.getRuntimeState();
        manager.pipeline.mock.calls[0][0].onProgress?.(75);
        expect(manager.getRuntimeState()).toBe(idle);
        expect(snapshots).toEqual([
          { kind: "installing", progress: null },
          { kind: "installing", progress: 50 },
          { kind: "idle" },
        ]);
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 prevents custom selection and removal from overwriting a running install", async () => {
        let finish!: (value: InstalledBinary) => void;
        manager.pipeline.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const installing = manager.install();
        await expect(manager.setCustomBinaryPath(null)).rejects.toBeInstanceOf(
          ManagedInstallOperationInFlightError
        );
        await expect(manager.uninstall()).rejects.toBeInstanceOf(
          ManagedInstallOperationInFlightError
        );
        expect(manager.getRuntimeState()).toEqual({ kind: "installing", progress: null });
        finish({ version: "1.2.3", path: "/managed/binary" });
        await installing;
      });
    });
    describe("isBusy()", () => {
      it("holds the lock until custom validation settles", async () => {
        expect(manager.isBusy()).toBe(false);
        const selecting = manager.setCustomBinaryPath(customPath);
        expect(manager.isBusy()).toBe(true);
        await selecting;
        expect(manager.isBusy()).toBe(false);
      });
    });
    describe("cancelCurrentOperation()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 aborts installation and leaves no retry error", async () => {
        manager.pipeline.mockImplementationOnce(
          ({ signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(new ManagedInstallAbortError()));
            })
        );
        const installing = manager.install();
        manager.cancelCurrentOperation();
        await expect(installing).rejects.toThrow("Aborted");
        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
        expect(manager.isBusy()).toBe(false);
        manager.cancelCurrentOperation();
      });
    });
    describe("forgetSettledError()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 preserves idle and running snapshots when a lifecycle reopens", async () => {
        const idle = manager.getRuntimeState();
        manager.forgetSettledError();
        expect(manager.getRuntimeState()).toBe(idle);
        let finish!: (value: InstalledBinary) => void;
        manager.pipeline.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const installing = manager.install();
        const running = manager.getRuntimeState();
        manager.forgetSettledError();
        expect(manager.getRuntimeState()).toBe(running);
        expect(manager.isBusy()).toBe(true);
        finish({ version: "1.2.3", path: "/managed/binary" });
        await installing;
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 clears a prior failure so a reopened lifecycle starts idle", async () => {
        manager.pipeline.mockRejectedValueOnce(new Error("failed"));
        await expect(manager.install()).rejects.toThrow("failed");
        expect(manager.getRuntimeState()).toEqual({
          kind: "error",
          message: "failed",
          operation: "install",
        });
        manager.forgetSettledError();
        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
      });
    });
    describe("downloadsSize()", () => {
      it("counts nested downloaded files and excludes external custom binaries", async () => {
        const nested = path.join(manager.getDataDir(), "1.2.3");
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, "binary"), "12345");
        fs.writeFileSync(path.join(manager.getDataDir(), "manifest"), "123");
        await expect(manager.downloadsSize()).resolves.toBe(8);
      });
      it("reports zero before any managed package is installed", async () => {
        await expect(manager.downloadsSize()).resolves.toBe(0);
      });
    });
    describe("uninstall()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 removes all managed versions and clears the managed selection", async () => {
        fs.mkdirSync(path.join(manager.getDataDir(), "1.2.3"), { recursive: true });
        manager.settings = {
          binaryPath: "/managed/binary",
          binaryVersion: "1.2.3",
          binarySource: "managed",
        };
        await manager.uninstall();
        expect(fs.existsSync(manager.getDataDir())).toBe(false);
        expect(fs.existsSync(customPath)).toBe(true);
        expect(manager.settings).toEqual({
          binaryPath: undefined,
          binaryVersion: undefined,
          binarySource: undefined,
        });
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 preserves the selected custom binary while reclaiming downloads", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        manager.settings = {
          binaryPath: customPath,
          binarySource: "custom",
          binaryVersion: "1.2.3",
        };
        const selected = manager.settings;
        await manager.uninstall();
        expect(fs.existsSync(manager.getDataDir())).toBe(false);
        expect(fs.existsSync(customPath)).toBe(true);
        expect(manager.settings).toEqual(selected);
      });
    });
    describe("setCustomBinaryPath()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 validates and selects a custom executable before removing managed downloads", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        manager.validate.mockImplementationOnce(async (binaryPath) => {
          expect(fs.existsSync(manager.getDataDir())).toBe(true);
          return { version: "1.2.3", path: binaryPath };
        });
        await manager.setCustomBinaryPath(customPath);
        expect(fs.existsSync(manager.getDataDir())).toBe(false);
        expect(fs.existsSync(customPath)).toBe(true);
        expect(manager.validate).toHaveBeenCalledWith(customPath);
        expect(manager.settings).toEqual({
          binaryPath: customPath,
          binaryVersion: "1.2.3",
          binarySource: "custom",
        });
      });
      it.each(["direct", "symlink", "symlink-directory"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves a selected %s path into the managed installation",
        async (kind) => {
          fs.mkdirSync(manager.getDataDir(), { recursive: true });
          const managedPath = path.join(manager.getDataDir(), "binary");
          fs.writeFileSync(managedPath, "binary", { mode: 0o755 });
          let selected = managedPath;
          if (kind === "symlink") {
            selected = path.join(tempDir, "alias");
            fs.symlinkSync(managedPath, selected);
          }
          if (kind === "symlink-directory") {
            const alias = path.join(tempDir, "alias");
            fs.symlinkSync(manager.getDataDir(), alias, "dir");
            selected = path.join(alias, "binary");
          }
          await manager.setCustomBinaryPath(selected);
          await manager.uninstall();
          expect(fs.existsSync(selected)).toBe(true);
          expect(manager.settings.binaryPath).toBe(selected);
        }
      );
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves a custom symlink stored inside the managed directory", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        const linked = path.join(manager.getDataDir(), "alias");
        fs.symlinkSync(customPath, linked);
        await manager.setCustomBinaryPath(linked);
        expect(fs.existsSync(linked)).toBe(true);
        expect(fs.existsSync(customPath)).toBe(true);
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 removes downloads when the custom directory only shares their name prefix", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        const external = `${manager.getDataDir()}-custom`;
        fs.mkdirSync(external);
        const selected = path.join(external, "binary");
        fs.writeFileSync(selected, "binary", { mode: 0o755 });
        await manager.setCustomBinaryPath(selected);
        expect(fs.existsSync(manager.getDataDir())).toBe(false);
        expect(fs.existsSync(selected)).toBe(true);
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves downloads when filesystem permissions prevent resolving the selected executable", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        const resolve = jest
          .spyOn(fs.promises, "realpath")
          .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
        try {
          await expect(manager.setCustomBinaryPath(customPath)).rejects.toThrow(
            "permission denied"
          );
          expect(fs.existsSync(manager.getDataDir())).toBe(true);
          expect(manager.settings.binaryPath).toBe(customPath);
        } finally {
          resolve.mockRestore();
        }
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 keeps the selected executable and reports failed download cleanup", async () => {
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        const remove = jest
          .spyOn(fs.promises, "rm")
          .mockRejectedValueOnce(new Error("permission denied"));
        try {
          await expect(manager.setCustomBinaryPath(customPath)).rejects.toThrow(
            "Your own binary is now in use, but Copilot could not remove its managed downloads: permission denied"
          );
          expect(manager.settings.binaryPath).toBe(customPath);
          expect(manager.settings.binarySource).toBe("custom");
          expect(fs.existsSync(customPath)).toBe(true);
          expect(fs.existsSync(manager.getDataDir())).toBe(true);
          expect(manager.getRuntimeState()).toMatchObject({
            kind: "error",
            operation: "configure",
          });
        } finally {
          remove.mockRestore();
        }
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 clears a selection without deleting its files", async () => {
        await manager.setCustomBinaryPath(customPath);
        await manager.setCustomBinaryPath(null);
        expect(manager.settings.binaryPath).toBeUndefined();
        expect(fs.existsSync(customPath)).toBe(true);
      });
      it.each([
        "missing",
        "directory",
        ...(process.platform === "win32" ? [] : ["not-executable"]),
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/368 rejects a %s path without replacing the current selection",
        async (kind) => {
          const candidate = path.join(tempDir, kind);
          if (kind === "directory") fs.mkdirSync(candidate);
          if (kind === "not-executable") fs.writeFileSync(candidate, "", { mode: 0o644 });
          manager.settings = {
            binaryPath: customPath,
            binaryVersion: "1.2.3",
            binarySource: "custom",
          };
          await expect(manager.setCustomBinaryPath(candidate)).rejects.toThrow();
          expect(manager.settings.binaryPath).toBe(customPath);
          expect(manager.validate).not.toHaveBeenCalled();
        }
      );
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 keeps the configured binary and identifies a path-validation failure", async () => {
        manager.settings = { binaryPath: "/previous" };
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        manager.validate.mockRejectedValueOnce(new Error("unsupported version"));
        await expect(manager.setCustomBinaryPath(customPath)).rejects.toThrow(
          "unsupported version"
        );
        expect(manager.settings.binaryPath).toBe("/previous");
        expect(fs.existsSync(manager.getDataDir())).toBe(true);
        expect(manager.getRuntimeState()).toEqual({
          kind: "error",
          message: "unsupported version",
          operation: "configure",
        });
      });
    });
  });
});
