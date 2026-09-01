import {
  getOpenArtifactsDocId,
  parseOpenArtifactsDocId,
  removeOpenArtifactsDocId,
  saveOpenArtifactsLink,
  OpenArtifactsFrontmatterParseError,
  OpenArtifactsPropertyConflictError,
} from "@/openArtifacts/openArtifactsFrontmatter";
import type { App, TFile } from "obsidian";

const DOC_ID = "9f2k4mvq7t0xbz3n";
const DOC_URL = `https://openartifacts.site/d/${DOC_ID}`;
const LEGACY_DOC_URL = `https://symposium.site/d/${DOC_ID}`;
const OTHER_DOC_ID = "0123456789abcdef";
const OTHER_DOC_URL = `https://openartifacts.site/d/${OTHER_DOC_ID}`;
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

describe("openArtifactsFrontmatter", () => {
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- path-only test fixture
  const file = { path: "Notes/Architecture.md" } as TFile;

  describe("OpenArtifactsPropertyConflictError", () => {
    describe("constructor()", () => {
      it("identifies an occupied reserved property", () => {
        const error = new OpenArtifactsPropertyConflictError();

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("already uses the symposium property");
      });
    });
  });

  describe("OpenArtifactsFrontmatterParseError", () => {
    describe("constructor()", () => {
      it("identifies frontmatter that cannot be parsed safely", () => {
        const error = new OpenArtifactsFrontmatterParseError();

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("frontmatter must be a YAML property map");
      });
    });
  });

  describe("parseOpenArtifactsDocId()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 reads the id from any https host so retired receipts stay manageable", () => {
      expect(parseOpenArtifactsDocId(DOC_URL)).toBe(DOC_ID);
      expect(parseOpenArtifactsDocId(LEGACY_DOC_URL)).toBe(DOC_ID);
      expect(parseOpenArtifactsDocId(`https://example.com/d/${DOC_ID}`)).toBe(DOC_ID);
      expect(parseOpenArtifactsDocId(`${DOC_URL}/`)).toBe(DOC_ID);
      expect(parseOpenArtifactsDocId(`http://openartifacts.site/d/${DOC_ID}`)).toBeNull();
      expect(parseOpenArtifactsDocId("https://openartifacts.site/d/UPPERCASE1234567")).toBeNull();
      expect(parseOpenArtifactsDocId("https://openartifacts.site/about")).toBeNull();
      expect(parseOpenArtifactsDocId(`https://openartifacts.site/d/${DOC_ID}/extra`)).toBeNull();
      expect(parseOpenArtifactsDocId(42)).toBeNull();
    });
  });

  describe("getOpenArtifactsDocId()", () => {
    it("reads an id from a valid link and treats missing frontmatter as unpublished", async () => {
      const valid = createApp({ symposium: DOC_URL });
      await expect(getOpenArtifactsDocId(valid.app, file)).resolves.toBe(DOC_ID);

      const missing = createApp();
      await expect(getOpenArtifactsDocId(missing.app, file)).resolves.toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/337 reads an existing id from the legacy persisted host", async () => {
      const legacy = createApp({ symposium: LEGACY_DOC_URL });

      await expect(getOpenArtifactsDocId(legacy.app, file)).resolves.toBe(DOC_ID);
    });

    it("rejects invalid YAML before its identity can be treated as unpublished", async () => {
      const invalidYaml = createApp();
      jest.mocked(invalidYaml.app.vault.read).mockResolvedValue("---\nsymposium: [\n---\n");
      await expect(getOpenArtifactsDocId(invalidYaml.app, file)).rejects.toBeInstanceOf(
        OpenArtifactsFrontmatterParseError
      );
    });

    it.each([
      ["sequence", "---\n- shared\n---\n"],
      ["scalar", "---\nshared\n---\n"],
    ])("rejects a YAML %s root that cannot hold properties", async (_case, markdown) => {
      const nonMapping = createApp();
      jest.mocked(nonMapping.app.vault.read).mockResolvedValue(markdown);

      await expect(getOpenArtifactsDocId(nonMapping.app, file)).rejects.toBeInstanceOf(
        OpenArtifactsFrontmatterParseError
      );
    });

    it("rejects an occupied property whose value is not a valid document link", async () => {
      const malformed = createApp({ symposium: { docId: DOC_ID } });

      await expect(getOpenArtifactsDocId(malformed.app, file)).rejects.toBeInstanceOf(
        OpenArtifactsPropertyConflictError
      );
    });
  });

  describe("saveOpenArtifactsLink()", () => {
    it("writes the public link when the reserved property is absent", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({ tags: ["public"] });

      await expect(saveOpenArtifactsLink(app, file, RECEIPT)).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ symposium: DOC_URL, tags: ["public"] });
    });

    it("treats an already-saved receipt identity as idempotent", async () => {
      const { app, frontmatter } = createApp({ symposium: DOC_URL });

      await expect(saveOpenArtifactsLink(app, file, RECEIPT)).resolves.toBe(true);
      expect(frontmatter.symposium).toBe(DOC_URL);
    });

    it("rejects a receipt whose link does not contain its id before changing the note", async () => {
      const { app, processFrontMatter } = createApp();

      await expect(
        saveOpenArtifactsLink(app, file, { ...RECEIPT, url: OTHER_DOC_URL })
      ).rejects.toThrow("Cannot save an invalid OpenArtifacts document link.");
      expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it("does not overwrite an identity that changed after the remote action began", async () => {
      const { app, frontmatter } = createApp({ symposium: OTHER_DOC_URL });

      await expect(saveOpenArtifactsLink(app, file, RECEIPT)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(OTHER_DOC_URL);
    });

    it("does not overwrite an occupied property with an unrecognized value", async () => {
      const existingValue = { url: "https://example.com/symposium" };
      const { app, frontmatter } = createApp({ symposium: existingValue });

      await expect(saveOpenArtifactsLink(app, file, RECEIPT)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(existingValue);
    });

    it("rejects a non-mapping root supplied by the atomic callback", async () => {
      const processFrontMatter = jest.fn(async (_file: TFile, update: (value: unknown) => void) =>
        update(["shared"])
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await expect(saveOpenArtifactsLink(app, file, RECEIPT)).rejects.toBeInstanceOf(
        OpenArtifactsFrontmatterParseError
      );
    });
  });

  describe("removeOpenArtifactsDocId()", () => {
    it("deletes only the OpenArtifacts property through processFrontMatter", async () => {
      const { app, frontmatter, processFrontMatter } = createApp({
        symposium: DOC_URL,
        tags: ["public"],
      });

      await expect(removeOpenArtifactsDocId(app, file, DOC_ID)).resolves.toBe(true);

      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      expect(frontmatter).toEqual({ tags: ["public"] });
    });

    it("does not remove an identity that changed after the remote deletion began", async () => {
      const { app, frontmatter } = createApp({ symposium: OTHER_DOC_URL });

      await expect(removeOpenArtifactsDocId(app, file, DOC_ID)).resolves.toBe(false);
      expect(frontmatter.symposium).toBe(OTHER_DOC_URL);
    });

    it("rejects a non-mapping root supplied by the atomic callback", async () => {
      const processFrontMatter = jest.fn(async (_file: TFile, update: (value: unknown) => void) =>
        update(["shared"])
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;

      await expect(removeOpenArtifactsDocId(app, file, DOC_ID)).rejects.toBeInstanceOf(
        OpenArtifactsFrontmatterParseError
      );
    });
  });
});
