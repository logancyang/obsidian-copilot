import { createMemoryVault } from "@/__tests__/memoryVault";
import {
  readFrontmatterFile,
  updateFrontmatter,
  writeFrontmatterFile,
} from "@/utils/vaultAdapterUtils";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3075";

describe("vaultAdapterUtils", () => {
  describe("writeFrontmatterFile()", () => {
    it(`keeps arrays and quoted strings through a write and a read ${ISSUE}`, async () => {
      const { app } = createMemoryVault();
      const frontmatter = { tags: ["a", "b"], title: "yes: really", empty: "" };

      await writeFrontmatterFile(app, ".copilot/a.md", frontmatter, "body");

      expect(await readFrontmatterFile(app, ".copilot/a.md")).toEqual({
        frontmatter,
        body: "body",
      });
    });
  });

  describe("readFrontmatterFile()", () => {
    it(`reads malformed YAML as empty but refuses to update it ${ISSUE}`, async () => {
      const raw = "---\nkey: [unclosed\n---\nbody";
      const { app, files } = createMemoryVault({ ".copilot/a.md": raw });

      expect(await readFrontmatterFile(app, ".copilot/a.md")).toEqual({
        frontmatter: {},
        body: "body",
      });
      await expect(updateFrontmatter(app, ".copilot/a.md", () => {})).rejects.toThrow();
      expect(files.get(".copilot/a.md")).toBe(raw);
    });
  });
});
