import {
  getSymposiumDocId,
  parseSymposiumDocId,
  removeSymposiumDocId,
  saveSymposiumDocId,
} from "@/symposium/symposiumFrontmatter";
import type { App, TFile } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";

interface TestApp {
  app: App;
  frontmatter: Record<string, unknown>;
  processFrontMatter: jest.Mock;
}

function createApp(frontmatter: Record<string, unknown> = {}): TestApp {
  const processFrontMatter = jest.fn(
    async (_file: TFile, update: (value: Record<string, unknown>) => void) => {
      update(frontmatter);
    }
  );
  const app = {
    vault: {
      read: jest.fn(async () => {
        const yaml = Object.entries(frontmatter)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join("\n");
        return yaml ? `---\n${yaml}\n---\n` : "";
      }),
    },
    fileManager: { processFrontMatter },
  } as unknown as App;

  return { app, frontmatter, processFrontMatter };
}

describe("symposiumFrontmatter", () => {
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- path-only test fixture
  const file = { path: "Notes/Architecture.md" } as TFile;

  describe("parseSymposiumDocId()", () => {
    it("accepts only lowercase 16-character Symposium ids", () => {
      expect(parseSymposiumDocId(DOC_ID)).toBe(DOC_ID);
      expect(parseSymposiumDocId("9F2K4MVQ7T0XBZ3N")).toBeNull();
      expect(parseSymposiumDocId("too-short")).toBeNull();
      expect(parseSymposiumDocId(42)).toBeNull();
      expect(parseSymposiumDocId(null)).toBeNull();
    });
  });

  describe("getSymposiumDocId()", () => {
    it("reads a valid id and treats missing or malformed frontmatter as unpublished", async () => {
      const valid = createApp({ symposium: DOC_ID });
      await expect(getSymposiumDocId(valid.app, file)).resolves.toBe(DOC_ID);

      const malformed = createApp({ symposium: { docId: DOC_ID } });
      await expect(getSymposiumDocId(malformed.app, file)).resolves.toBeNull();

      const missing = createApp();
      await expect(getSymposiumDocId(missing.app, file)).resolves.toBeNull();

      const invalidYaml = createApp();
      jest.mocked(invalidYaml.app.vault.read).mockResolvedValue("---\nsymposium: [\n---\n");
      await expect(getSymposiumDocId(invalidYaml.app, file)).resolves.toBeNull();
    });
  });

  describe("saveSymposiumDocId()", () => {
    it("writes or replaces the property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: "0123456789abcdef",
        tags: ["public"],
      });

      await expect(saveSymposiumDocId(app, file, DOC_ID, "0123456789abcdef")).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ symposium: DOC_ID, tags: ["public"] });
    });

    it("rejects an invalid id before changing the note", async () => {
      const { app, processFrontMatter } = createApp();

      await expect(saveSymposiumDocId(app, file, "INVALID", null)).rejects.toThrow(
        "Cannot save an invalid Symposium document id."
      );
      expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it("does not overwrite an identity that changed after the remote action began", async () => {
      const newerDocId = "0123456789abcdef";
      const { app, frontmatter } = createApp({ symposium: newerDocId });

      await expect(saveSymposiumDocId(app, file, DOC_ID, null)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(newerDocId);
    });
  });

  describe("removeSymposiumDocId()", () => {
    it("deletes only the Symposium property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: DOC_ID,
        tags: ["public"],
      });

      await expect(removeSymposiumDocId(app, file, DOC_ID)).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ tags: ["public"] });
    });

    it("does not remove an identity that changed after the remote deletion began", async () => {
      const newerDocId = "0123456789abcdef";
      const { app, frontmatter } = createApp({ symposium: newerDocId });

      await expect(removeSymposiumDocId(app, file, DOC_ID)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(newerDocId);
    });
  });
});
