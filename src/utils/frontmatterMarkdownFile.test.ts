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

describe("frontmatterMarkdownFile", () => {
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
      const parsed = await readFrontmatterMarkdownFile(app, ".copilot/commands/example.md");

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
