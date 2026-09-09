import type { App } from "obsidian";
import { buildBuiltinSeedFs } from "./miyoSearchSeed";

describe("buildBuiltinSeedFs", () => {
  describe("buildBuiltinSeedFs()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 removes a retired file through the file API, not recursive directory removal", async () => {
      const adapter = { remove: jest.fn().mockResolvedValue(undefined), rmdir: jest.fn() };
      const app = { vault: { adapter } } as unknown as App;

      await buildBuiltinSeedFs(app).removeFile("skills/example/retired.md");

      expect(adapter.remove).toHaveBeenCalledWith("skills/example/retired.md");
      expect(adapter.rmdir).not.toHaveBeenCalled();
    });
  });
});
