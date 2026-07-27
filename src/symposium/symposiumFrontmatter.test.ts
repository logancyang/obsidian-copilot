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
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter })),
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
    it("reads a valid id and treats missing or malformed metadata as unpublished", () => {
      const valid = createApp({ symposium: DOC_ID });
      expect(getSymposiumDocId(valid.app, file)).toBe(DOC_ID);

      const malformed = createApp({ symposium: { docId: DOC_ID } });
      expect(getSymposiumDocId(malformed.app, file)).toBeNull();

      const missingCache = {
        metadataCache: { getFileCache: jest.fn(() => null) },
      } as unknown as App;
      expect(getSymposiumDocId(missingCache, file)).toBeNull();
    });
  });

  describe("saveSymposiumDocId()", () => {
    it("writes or replaces the property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: "0123456789abcdef",
        tags: ["public"],
      });

      await saveSymposiumDocId(app, file, DOC_ID);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ symposium: DOC_ID, tags: ["public"] });
    });

    it("rejects an invalid id before changing the note", async () => {
      const { app, processFrontMatter } = createApp();

      await expect(saveSymposiumDocId(app, file, "INVALID")).rejects.toThrow(
        "Cannot save an invalid Symposium document id."
      );
      expect(processFrontMatter).not.toHaveBeenCalled();
    });
  });

  describe("removeSymposiumDocId()", () => {
    it("deletes only the Symposium property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: DOC_ID,
        tags: ["public"],
      });

      await removeSymposiumDocId(app, file);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ tags: ["public"] });
    });
  });
});
