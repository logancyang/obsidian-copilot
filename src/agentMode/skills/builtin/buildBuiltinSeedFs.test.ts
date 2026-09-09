import type { App } from "obsidian";
import { buildBuiltinSeedFs } from "./miyoSearchSeed";

describe("buildBuiltinSeedFs", () => {
  describe("buildBuiltinSeedFs()", () => {
    it("removes only empty directories without recursive deletion https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const adapter = {
        exists: jest.fn(async (path: string) => path !== "absent"),
        list: jest.fn(async (path: string) => ({
          files: path === "user-content" ? ["personal.md"] : [],
          folders: [],
        })),
        rmdir: jest.fn().mockResolvedValue(undefined),
      };
      const fs = buildBuiltinSeedFs({ vault: { adapter } } as unknown as App);
      await fs.removeEmptyDir("absent");
      await fs.removeEmptyDir("user-content");
      await fs.removeEmptyDir("empty");
      expect(adapter.rmdir).toHaveBeenCalledTimes(1);
      expect(adapter.rmdir).toHaveBeenCalledWith("empty", false);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 removes a retired file through the file API, not recursive directory removal", async () => {
      const adapter = { remove: jest.fn().mockResolvedValue(undefined), rmdir: jest.fn() };
      const app = { vault: { adapter } } as unknown as App;

      await buildBuiltinSeedFs(app).removeFile("skills/example/retired.md");

      expect(adapter.remove).toHaveBeenCalledWith("skills/example/retired.md");
      expect(adapter.rmdir).not.toHaveBeenCalled();
    });
  });
});
