import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logWarn } from "@/logger";
import { pruneManagedRuntimes } from "@/agentMode/backends/shared/managedRuntimeCleanup";
import type { BinarySettings } from "@/agentMode/backends/shared/ManagedBinaryManager";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/537";

describe("managedRuntimeCleanup", () => {
  describe("pruneManagedRuntimes()", () => {
    let root: string;
    let selected: BinarySettings;
    const installed = async (directory: string) => fs.existsSync(path.join(directory, "complete"));
    function make(version: string, completed = true): string {
      const directory = path.join(root, version);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "binary"), "executable");
      if (completed) fs.writeFileSync(path.join(directory, "complete"), "verified");
      return directory;
    }
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-cleanup-"));
      selected = {
        binarySource: "managed",
        binaryVersion: "2.0.0",
        binaryPath: path.join(make("2.0.0"), "binary"),
      };
      jest.mocked(logWarn).mockClear();
    });
    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it(`removes completed lower versions and retains selected, equal and newer versions ${ISSUE}`, async () => {
      const old = make("1.9.0");
      const legacyUuid = make("1.8.0-12345678-1234-1234-1234-123456789012");
      const equal = make("2.0.0-12345678-1234-1234-1234-123456789012");
      const newer = make("10.0.0");
      await pruneManagedRuntimes(root, selected, installed);
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(legacyUuid)).toBe(false);
      expect(fs.existsSync(equal)).toBe(true);
      expect(fs.existsSync(newer)).toBe(true);
      expect(fs.existsSync(selected.binaryPath!)).toBe(true);
    });

    it(`retains staging, incomplete and unrecognized directories ${ISSUE}`, async () => {
      const kept = [make(".tmp-1.0.0"), make("1.0.0", false), make("custom-agent")];
      await pruneManagedRuntimes(root, selected, installed);
      for (const directory of kept) expect(fs.existsSync(directory)).toBe(true);
    });

    it.each(["custom", "missing", "external", "unconfigured"])(
      `does not reclaim downloads for a %s selection ${ISSUE}`,
      async (kind) => {
        const old = make("1.0.0");
        if (kind === "custom") selected.binarySource = "custom";
        if (kind === "missing") fs.unlinkSync(selected.binaryPath!);
        if (kind === "external") selected.binaryPath = __filename;
        if (kind === "unconfigured") selected = {};
        await pruneManagedRuntimes(root, selected, installed);
        expect(fs.existsSync(old)).toBe(true);
      }
    );

    it(`preserves the selected directory even when saved version metadata differs ${ISSUE}`, async () => {
      selected.binaryPath = path.join(make("1.0.0"), "binary");
      await pruneManagedRuntimes(root, selected, installed);
      expect(fs.existsSync(selected.binaryPath)).toBe(true);
    });

    it(`does not follow a candidate directory symlink ${ISSUE}`, async () => {
      const target = make("external-owner");
      fs.symlinkSync(
        target,
        path.join(root, "1.0.0"),
        process.platform === "win32" ? "junction" : "dir"
      );
      await pruneManagedRuntimes(root, selected, installed);
      expect(fs.existsSync(path.join(target, "binary"))).toBe(true);
      expect(fs.lstatSync(path.join(root, "1.0.0")).isSymbolicLink()).toBe(true);
    });

    it(`leaves deletion failures nonblocking and reclaims them on a later pass ${ISSUE}`, async () => {
      const old = make("1.0.0");
      const remove = jest.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("file busy"));
      await expect(pruneManagedRuntimes(root, selected, installed)).resolves.toBeUndefined();
      expect(fs.existsSync(old)).toBe(true);
      expect(logWarn).toHaveBeenCalled();
      remove.mockRestore();
      await pruneManagedRuntimes(root, selected, installed);
      expect(fs.existsSync(old)).toBe(false);
    });
  });
});
