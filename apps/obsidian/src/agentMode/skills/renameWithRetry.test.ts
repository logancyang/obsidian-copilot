import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renameWithRetry } from "./renameWithRetry";

const errnoError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: rename failed`), { code });

describe("renameWithRetry", () => {
  describe("renameWithRetry()", () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-rename-retry-"));
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("moves a directory to a free destination", async () => {
      const from = path.join(root, "from");
      const to = path.join(root, "to");
      fs.mkdirSync(from);
      fs.writeFileSync(path.join(from, "file"), "content");

      await renameWithRetry(from, to);

      expect(fs.readFileSync(path.join(to, "file"), "utf8")).toBe("content");
      expect(fs.existsSync(from)).toBe(false);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3822 keeps retrying while Windows reports the path as locked and succeeds once the lock clears", async () => {
      jest.useFakeTimers();
      const lockedUntil = Date.now() + 5_000;
      const rename = jest.spyOn(fs.promises, "rename").mockImplementation(async () => {
        if (Date.now() < lockedUntil) throw errnoError("EPERM");
      });

      const result = renameWithRetry("from", "to", 10_000);
      await jest.advanceTimersByTimeAsync(6_000);

      await expect(result).resolves.toBeUndefined();
      expect(rename.mock.calls.length).toBeGreaterThan(3);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3822 rethrows the lock error when the path stays locked past the timeout", async () => {
      jest.useFakeTimers();
      jest.spyOn(fs.promises, "rename").mockRejectedValue(errnoError("EBUSY"));

      const result = renameWithRetry("from", "to", 1_000);
      const assertion = expect(result).rejects.toMatchObject({ code: "EBUSY" });
      await jest.advanceTimersByTimeAsync(1_500);

      await assertion;
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3822 fails on the first attempt when the error is not a lock, such as a missing source", async () => {
      const rename = jest.spyOn(fs.promises, "rename");

      await expect(
        renameWithRetry(path.join(root, "missing"), path.join(root, "to"), 10_000)
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(rename).toHaveBeenCalledTimes(1);
    });
  });
});
