import {
  deleteFrontmatterMarkdownFile,
  listFrontmatterMarkdownFiles,
  readFrontmatterMarkdownFile,
  renameFrontmatterMarkdownFile,
  updateFrontmatterMarkdownFile,
  writeFrontmatterMarkdownFile,
} from "@/utils/frontmatterMarkdownFile";
import { parseYaml, stringifyYaml, TFile } from "obsidian";
import * as vaultAdapterUtils from "@/utils/vaultAdapterUtils";
import { logWarn } from "@/logger";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

jest.mock("@/utils", () => ({
  stripFrontmatter: (content: string) => content.replace(/^---\n[\s\S]*?\n---\n/, ""),
}));

jest.mock("obsidian", () => {
  const yaml = jest.requireActual<typeof import("yaml")>("yaml");
  return {
    TFile: class TFile {},
    parseYaml: yaml.parse,
    stringifyYaml: yaml.stringify,
  };
});

jest.mock("@/utils/vaultAdapterUtils", () => ({
  isInVaultCache: jest.fn(() => false),
  listMarkdownFiles: jest.fn(async () => []),
  resolveFileByPath: jest.fn(async (_app: unknown, path: string) =>
    path === ".copilot/commands/example.md" ? { path } : null
  ),
  trashFile: jest.fn(),
}));

function hiddenFile(path: string): TFile {
  return Object.assign(new (TFile as unknown as new () => TFile)(), { path });
}

function hiddenApp(raw: string): { app: never; read: jest.Mock } {
  const read = jest.fn(async () => raw);
  return { app: { vault: { adapter: { read } } } as never, read };
}

describe("frontmatterMarkdownFile", () => {
  describe("readFrontmatterMarkdownFile()", () => {
    it("hands indexed files to the metadata cache like any visible vault file for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      jest.mocked(vaultAdapterUtils.isInVaultCache).mockReturnValueOnce(true);
      const file = hiddenFile("commands/example.md");
      const app = {
        vault: { read: jest.fn(async () => "---\nslash: true\n---\nBody") },
        metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: { slash: true } })) },
      } as never;

      await expect(readFrontmatterMarkdownFile(app, file)).resolves.toEqual({
        content: "Body",
        frontmatter: { slash: true },
        hasMalformedFrontmatter: false,
      });
    });

    it("treats malformed YAML in an unindexed file as empty frontmatter instead of throwing for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const { app } = hiddenApp("---\ndescription: Summarize: briefly\n---\nBody");

      const parsed = await readFrontmatterMarkdownFile(app, hiddenFile(".copilot/a.md"));

      expect(parsed).toMatchObject({ frontmatter: {}, hasMalformedFrontmatter: true });
      expect(logWarn).toHaveBeenCalled();
    });

    it("recognizes an empty frontmatter block without swallowing a later horizontal rule for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const { app } = hiddenApp("---\n---\nBody\n---\nMore");

      const parsed = await readFrontmatterMarkdownFile(app, hiddenFile(".copilot/a.md"));

      expect(parsed).toEqual({
        content: "Body\n---\nMore",
        frontmatter: {},
        hasMalformedFrontmatter: false,
      });
    });

    it.each([
      ["CRLF line endings", "---\r\nslash: true\r\n---\r\nBody"],
      ["a leading BOM", "\uFEFF---\nslash: true\n---\nBody"],
    ])(
      "parses frontmatter with %s for https://github.com/logancyang/obsidian-copilot/issues/3075",
      async (_name, raw) => {
        const { app } = hiddenApp(raw);

        const parsed = await readFrontmatterMarkdownFile(app, hiddenFile(".copilot/a.md"));

        expect(parsed).toMatchObject({ content: "Body", frontmatter: { slash: true } });
      }
    );

    it("returns the whole file as the body when there is no frontmatter for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const { app } = hiddenApp("Just a body");

      const parsed = await readFrontmatterMarkdownFile(app, hiddenFile(".copilot/a.md"));

      expect(parsed).toMatchObject({ content: "Just a body", frontmatter: {} });
    });
  });

  describe("writeFrontmatterMarkdownFile()", () => {
    it("round-trips arrays and quoted strings using Obsidian frontmatter serialization for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const files = new Map<string, string>([
        [".copilot/commands/example.md", `---\nkeep: true\n---\nOld body`],
      ]);
      const adapter = {
        read: jest.fn(async (path: string) => files.get(path) ?? ""),
        write: jest.fn(async (path: string, value: string) => {
          files.set(path, value);
        }),
      };
      const app = { vault: { adapter, getAbstractFileByPath: jest.fn(() => null) } } as never;
      const frontmatter = {
        "copilot-command-model-key": 'provider/"quoted"',
        "copilot-command-allowed-tools": ["read", "write: note"],
      };
      const fullFrontmatter = { keep: true, ...frontmatter };
      const body = "Use the selected tools.";

      await writeFrontmatterMarkdownFile(app, ".copilot/commands/example.md", body, frontmatter);
      const parsed = await readFrontmatterMarkdownFile(
        app,
        hiddenFile(".copilot/commands/example.md")
      );

      expect(adapter.write).toHaveBeenCalledWith(
        ".copilot/commands/example.md",
        `---\n${stringifyYaml(fullFrontmatter)}---\n${body}`
      );
      expect(parsed?.frontmatter).toEqual(fullFrontmatter);
      expect(parsed?.content).toBe(body);
      expect(parseYaml(stringifyYaml(fullFrontmatter))).toEqual(fullFrontmatter);
      expect(vaultAdapterUtils.isInVaultCache).toHaveBeenCalled();
    });
  });

  describe("listFrontmatterMarkdownFiles()", () => {
    it("lists hidden-folder markdown files for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const files = [{ path: ".copilot/commands/example.md" }] as unknown as TFile[];
      const app = { vault: { getAbstractFileByPath: jest.fn() } } as never;
      jest.mocked(vaultAdapterUtils.listMarkdownFiles).mockResolvedValue(files);

      await expect(listFrontmatterMarkdownFiles(app, ".copilot/commands")).resolves.toBe(files);
      expect(vaultAdapterUtils.listMarkdownFiles).toHaveBeenCalledWith(app, ".copilot/commands");
    });
  });

  describe("updateFrontmatterMarkdownFile()", () => {
    it("updates hidden-file metadata while preserving arrays and body text for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const original = `---\n${stringifyYaml({ names: ["a", "b"], label: 'say "hi"' })}---\nBody`;
      const adapter = {
        read: jest.fn(async () => original),
        write: jest.fn(async () => {}),
      };
      const app = { vault: { adapter, getAbstractFileByPath: jest.fn(() => null) } } as never;

      await updateFrontmatterMarkdownFile(app, ".copilot/commands/example.md", (metadata) => {
        metadata.active = true;
      });

      expect(adapter.write).toHaveBeenCalledWith(
        ".copilot/commands/example.md",
        `---\n${stringifyYaml({ names: ["a", "b"], label: 'say "hi"', active: true })}---\nBody`
      );
    });
  });

  describe("updateFrontmatterMarkdownFile() with malformed YAML", () => {
    it("leaves a hidden file untouched instead of rewriting its unreadable frontmatter for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const read = jest.fn(async () => "---\ndescription: Summarize: briefly\n---\nBody");
      const write = jest.fn(async () => {});
      const app = {
        vault: { adapter: { read, write }, getAbstractFileByPath: jest.fn(() => null) },
      } as never;
      const update = jest.fn();

      await updateFrontmatterMarkdownFile(app, ".copilot/commands/example.md", update);

      expect(update).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });
  });

  describe("renameFrontmatterMarkdownFile()", () => {
    it("renames a hidden markdown path through the adapter for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const rename = jest.fn(async () => {});
      const app = {
        vault: { adapter: { rename }, getAbstractFileByPath: jest.fn(() => null) },
      } as never;

      await renameFrontmatterMarkdownFile(
        app,
        ".copilot/commands/old.md",
        ".copilot/commands/new.md"
      );

      expect(rename).toHaveBeenCalledWith(".copilot/commands/old.md", ".copilot/commands/new.md");
    });
  });

  describe("deleteFrontmatterMarkdownFile()", () => {
    it("removes an existing hidden markdown path through the adapter for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const remove = jest.fn(async () => {});
      const app = {
        vault: {
          adapter: { exists: jest.fn(async () => true), remove },
          getAbstractFileByPath: jest.fn(() => null),
        },
      } as never;

      await deleteFrontmatterMarkdownFile(app, ".copilot/commands/example.md");

      expect(remove).toHaveBeenCalledWith(".copilot/commands/example.md");
    });
  });
});
