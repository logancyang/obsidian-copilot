import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createManagedInstallRuntime,
  ManagedInstallAbortError,
  ManagedInstallOperationInFlightError,
  promoteManagedVersion,
} from "./managedInstall";

jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn() }));

describe("managedInstall", () => {
  describe("createManagedInstallRuntime()", () => {
    it("publishes one operation and rejects a competing surface (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", async () => {
      const runtime = createManagedInstallRuntime<{ percent: number }>("Codex");
      const listener = jest.fn();
      const unsubscribe = runtime.subscribe(listener);
      let finish: (() => void) | undefined;
      const first = runtime.run(
        { kind: "installing", progress: null },
        () => new Promise<void>((resolve) => (finish = resolve))
      );

      expect(runtime.isBusy()).toBe(true);
      expect(runtime.getSnapshot()).toEqual({ kind: "installing", progress: null });
      await expect(runtime.run({ kind: "busy" }, async () => undefined)).rejects.toEqual(
        expect.any(ManagedInstallOperationInFlightError)
      );

      runtime.publishProgress({ percent: 50 });
      expect(runtime.getSnapshot()).toEqual({ kind: "installing", progress: { percent: 50 } });
      finish?.();
      await first;
      expect(runtime.getSnapshot()).toEqual({ kind: "idle" });
      expect(listener).toHaveBeenCalledTimes(3);

      unsubscribe();
      runtime.publishProgress({ percent: 75 });
      expect(runtime.getSnapshot()).toEqual({ kind: "idle" });
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("returns to idle after cancellation without publishing a retry failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/368)", async () => {
      const runtime = createManagedInstallRuntime("Codex");
      const operation = runtime.run({ kind: "installing", progress: null }, async (signal) => {
        runtime.cancel();
        if (signal.aborted) throw new ManagedInstallAbortError();
      });

      await expect(operation).rejects.toEqual(expect.any(ManagedInstallAbortError));
      expect(runtime.getSnapshot()).toEqual({ kind: "idle" });
      expect(runtime.isBusy()).toBe(false);
    });

    it("publishes failures until the next lifecycle forgets the settled error", async () => {
      const runtime = createManagedInstallRuntime("Codex");

      await expect(
        runtime.run({ kind: "busy" }, async () => {
          throw new Error("network unavailable");
        })
      ).rejects.toThrow("network unavailable");
      expect(runtime.getSnapshot()).toEqual({ kind: "error", message: "network unavailable" });

      runtime.forgetSettledError();
      expect(runtime.getSnapshot()).toEqual({ kind: "idle" });
    });
  });

  describe("promoteManagedVersion()", () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-managed-install-"));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("atomically replaces an existing version directory and removes the old copy", async () => {
      const stage = path.join(root, "stage");
      const version = path.join(root, "1.0.0");
      fs.mkdirSync(stage);
      fs.mkdirSync(version);
      fs.writeFileSync(path.join(stage, "new"), "new");
      fs.writeFileSync(path.join(version, "old"), "old");

      await promoteManagedVersion(stage, version, "Codex");

      expect(fs.readFileSync(path.join(version, "new"), "utf8")).toBe("new");
      expect(fs.existsSync(path.join(version, "old"))).toBe(false);
      expect(fs.readdirSync(root)).toEqual(["1.0.0"]);
    });

    it("promotes into an absent version directory", async () => {
      const stage = path.join(root, "stage");
      const version = path.join(root, "1.0.0");
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, "new"), "new");

      await promoteManagedVersion(stage, version, "Codex");

      expect(fs.readFileSync(path.join(version, "new"), "utf8")).toBe("new");
    });
  });
});
