import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promoteManagedVersion } from "./managedInstall";

jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn() }));

describe("managedInstall", () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 restores the prior installation when staged promotion fails", async () => {
      const stage = path.join(root, "missing-stage");
      const version = path.join(root, "1.0.0");
      fs.mkdirSync(version);
      fs.writeFileSync(path.join(version, "old"), "previous runtime");

      await expect(promoteManagedVersion(stage, version, "Codex")).rejects.toThrow();

      expect(fs.readFileSync(path.join(version, "old"), "utf8")).toBe("previous runtime");
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

    it("https://github.com/logancyang/obsidian-copilot/issues/3822 promotes the staged directory once another program releases a file inside it", async () => {
      const stage = path.join(root, "stage");
      const version = path.join(root, "1.0.0");
      fs.mkdirSync(stage);
      fs.writeFileSync(path.join(stage, "new"), "new");
      const realRename = fs.promises.rename.bind(fs.promises);
      let lockedAttempts = 5;
      const rename = jest.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
        if (from === stage && lockedAttempts-- > 0) {
          throw Object.assign(new Error("EPERM: operation not permitted, rename"), {
            code: "EPERM",
          });
        }
        return realRename(from, to);
      });

      try {
        await promoteManagedVersion(stage, version, "opencode");
      } finally {
        rename.mockRestore();
      }

      expect(fs.readFileSync(path.join(version, "new"), "utf8")).toBe("new");
      expect(fs.existsSync(stage)).toBe(false);
    });
  });
});
