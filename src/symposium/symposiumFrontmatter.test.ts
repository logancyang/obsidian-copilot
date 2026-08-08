import {
  getSymposiumDocId,
  parseSymposiumDocId,
  removeSymposiumDocId,
  saveSymposiumLink,
  SymposiumFrontmatterParseError,
  SymposiumPropertyConflictError,
} from "@/symposium/symposiumFrontmatter";
import type { App, TFile } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const DOC_URL = `https://symposium.site/d/${DOC_ID}`;
const OTHER_DOC_ID = "0123456789abcdef";
const OTHER_DOC_URL = `https://symposium.site/d/${OTHER_DOC_ID}`;
const RECEIPT = { docId: DOC_ID, url: DOC_URL, version: 1 };

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

  describe("SymposiumPropertyConflictError", () => {
    describe("constructor()", () => {
      it("identifies an occupied reserved property", () => {
        const error = new SymposiumPropertyConflictError();

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("already uses the symposium property");
      });
    });
  });

  describe("SymposiumFrontmatterParseError", () => {
    describe("constructor()", () => {
      it("identifies frontmatter that cannot be parsed safely", () => {
        const error = new SymposiumFrontmatterParseError();

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("frontmatter must be a YAML property map");
      });
    });
  });

  describe("parseSymposiumDocId()", () => {
    it("extracts lowercase 16-character ids only from HTTPS document links", () => {
      expect(parseSymposiumDocId(`${DOC_URL}?source=note`)).toBe(DOC_ID);
      expect(parseSymposiumDocId(DOC_ID)).toBeNull();
      expect(parseSymposiumDocId(`http://symposium.site/d/${DOC_ID}`)).toBeNull();
      expect(parseSymposiumDocId("https://symposium.site/d/UPPERCASE1234567")).toBeNull();
      expect(parseSymposiumDocId("https://symposium.site/about")).toBeNull();
      expect(parseSymposiumDocId(42)).toBeNull();
      expect(parseSymposiumDocId(null)).toBeNull();
    });
  });

  describe("getSymposiumDocId()", () => {
    it("reads an id from a valid link and treats missing frontmatter as unpublished", async () => {
      const valid = createApp({ symposium: DOC_URL });
      await expect(getSymposiumDocId(valid.app, file)).resolves.toBe(DOC_ID);

      const missing = createApp();
      await expect(getSymposiumDocId(missing.app, file)).resolves.toBeNull();
    });

    it("rejects invalid YAML before its identity can be treated as unpublished", async () => {
      const invalidYaml = createApp();
      jest.mocked(invalidYaml.app.vault.read).mockResolvedValue("---\nsymposium: [\n---\n");
      await expect(getSymposiumDocId(invalidYaml.app, file)).rejects.toBeInstanceOf(
        SymposiumFrontmatterParseError
      );
    });

    it.each([
      ["sequence", "---\n- shared\n---\n"],
      ["scalar", "---\nshared\n---\n"],
    ])("rejects a YAML %s root that cannot hold properties", async (_case, markdown) => {
      const nonMapping = createApp();
      jest.mocked(nonMapping.app.vault.read).mockResolvedValue(markdown);

      await expect(getSymposiumDocId(nonMapping.app, file)).rejects.toBeInstanceOf(
        SymposiumFrontmatterParseError
      );
    });

    it("rejects an occupied property whose value is not a valid document link", async () => {
      const malformed = createApp({ symposium: { docId: DOC_ID } });

      await expect(getSymposiumDocId(malformed.app, file)).rejects.toBeInstanceOf(
        SymposiumPropertyConflictError
      );
    });
  });

  describe("saveSymposiumLink()", () => {
    it("writes the public link when the reserved property is absent", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({ tags: ["public"] });

      await expect(saveSymposiumLink(app, file, RECEIPT)).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ symposium: DOC_URL, tags: ["public"] });
    });

    it("treats an already-saved receipt identity as idempotent", async () => {
      const { app, frontmatter } = createApp({ symposium: DOC_URL });

      await expect(saveSymposiumLink(app, file, RECEIPT)).resolves.toBe(true);
      expect(frontmatter.symposium).toBe(DOC_URL);
    });

    it("rejects a receipt whose link does not contain its id before changing the note", async () => {
      const { app, processFrontMatter } = createApp();

      await expect(
        saveSymposiumLink(app, file, { ...RECEIPT, url: OTHER_DOC_URL })
      ).rejects.toThrow("Cannot save an invalid Symposium document link.");
      expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it("does not overwrite an identity that changed after the remote action began", async () => {
      const { app, frontmatter } = createApp({ symposium: OTHER_DOC_URL });

      await expect(saveSymposiumLink(app, file, RECEIPT)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(OTHER_DOC_URL);
    });

    it("does not overwrite an occupied property with an unrecognized value", async () => {
      const existingValue = { url: "https://example.com/symposium" };
      const { app, frontmatter } = createApp({ symposium: existingValue });

      await expect(saveSymposiumLink(app, file, RECEIPT)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(existingValue);
    });

    it("rejects a non-mapping root supplied by the atomic callback", async () => {
      const processFrontMatter = jest.fn(async (_file: TFile, update: (value: unknown) => void) =>
        update(["shared"])
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await expect(saveSymposiumLink(app, file, RECEIPT)).rejects.toBeInstanceOf(
        SymposiumFrontmatterParseError
      );
    });
  });

  describe("removeSymposiumDocId()", () => {
    it("deletes only the Symposium property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: DOC_URL,
        tags: ["public"],
      });

      await expect(removeSymposiumDocId(app, file, DOC_ID)).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ tags: ["public"] });
    });

    it("does not remove an identity that changed after the remote deletion began", async () => {
      const { app, frontmatter } = createApp({ symposium: OTHER_DOC_URL });

      await expect(removeSymposiumDocId(app, file, DOC_ID)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(OTHER_DOC_URL);
    });

    it("rejects a non-mapping root supplied by the atomic callback", async () => {
      const processFrontMatter = jest.fn(async (_file: TFile, update: (value: unknown) => void) =>
        update(["shared"])
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await expect(removeSymposiumDocId(app, file, DOC_ID)).rejects.toBeInstanceOf(
        SymposiumFrontmatterParseError
      );
    });
  });
});
