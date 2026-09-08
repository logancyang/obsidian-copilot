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
      return { version: "1.2.3", path: "/managed/binary" };
    }
  );

  constructor(private dataDir: string) {
    super("Test agent");
  }
  getDataDir(): string {
    return this.dataDir;
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
