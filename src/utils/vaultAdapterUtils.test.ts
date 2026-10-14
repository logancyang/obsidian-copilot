import { mockTFile } from "@/__tests__/mockObsidian";
import { patchFrontmatter } from "@/utils/vaultAdapterUtils";
import type { App, TFile } from "obsidian";

function makeCachedNoteApp(note: TFile, frontmatter: Record<string, unknown>) {
  return {
    vault: { getAbstractFileByPath: jest.fn((path: string) => (path === note.path ? note : null)) },
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update(frontmatter)
      ),
    },
  } as unknown as App;
}

function makeHiddenNoteApp(files: Map<string, string>) {
  return {
    vault: {
      getAbstractFileByPath: jest.fn(() => null),
      adapter: {
        exists: jest.fn(async (path: string) => files.has(path)),
        read: jest.fn(async (path: string) => files.get(path) ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          files.set(path, content);
        }),
      },
    },
    fileManager: { processFrontMatter: jest.fn() },
  } as unknown as App;
}

describe("vaultAdapterUtils", () => {
  describe("patchFrontmatter()", () => {
    it("https://github.com/logancyang/obsidian-copilot/issues/3195 sets and removes keys through Obsidian's frontmatter API for a note in the vault cache", async () => {
      const note = mockTFile({ path: "chats/agent__a.md" });
      const frontmatter: Record<string, unknown> = { topic: "Plan", pinnedAt: 1_000 };

      await patchFrontmatter(makeCachedNoteApp(note, frontmatter), note.path, {
        topic: "Renamed",
        pinnedAt: null,
      });

      expect(frontmatter).toEqual({ topic: "Renamed" });
    });

    it("rewrites only the targeted keys of a note outside the vault cache", async () => {
      const path = ".copilot/chats/agent__hidden.md";
      const files = new Map([[path, '---\nepoch: 1000\ntopic: "Old"\n---\n\nbody']]);

      await patchFrontmatter(makeHiddenNoteApp(files), path, { topic: "New", pinnedAt: 2_000 });

      expect(files.get(path)).toBe('---\nepoch: 1000\ntopic: "New"\npinnedAt: 2000\n---\n\nbody');
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 removes a key set to null from a note outside the vault cache and keeps its line endings", async () => {
      const path = ".copilot/chats/agent__hidden.md";
      const files = new Map([
        [path, "---\r\nepoch: 1000\r\npinnedAt: 2000\r\nmode: agent\r\n---\r\n"],
      ]);

      await patchFrontmatter(makeHiddenNoteApp(files), path, { pinnedAt: null });

      expect(files.get(path)).toBe("---\r\nepoch: 1000\r\nmode: agent\r\n---\r\n");
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3195 leaves a note outside the vault cache untouched when removing a key it does not have", async () => {
      const path = ".copilot/chats/agent__hidden.md";
      const files = new Map([[path, "---\nepoch: 1000\n---\n"]]);
      const app = makeHiddenNoteApp(files);

      await patchFrontmatter(app, path, { pinnedAt: null });

      expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });
  });
});
