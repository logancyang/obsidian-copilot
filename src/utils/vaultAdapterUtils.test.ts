import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { listMarkdownFiles, patchFrontmatter } from "@/utils/vaultAdapterUtils";
import type { App, TFile } from "obsidian";

function makeNoteApp(note: TFile, frontmatter: Record<string, unknown>) {
  return {
    vault: { getAbstractFileByPath: jest.fn((path: string) => (path === note.path ? note : null)) },
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: TFile, update: (fm: Record<string, unknown>) => void) => update(frontmatter)
      ),
    },
  } as unknown as App;
}

describe("vaultAdapterUtils", () => {
  describe("listMarkdownFiles()", () => {
    it("lists the vault's markdown notes under an existing folder", () => {
      const folder = mockTFolder({ path: "copilot/copilot-conversations" });
      const chat = mockTFile({ path: "copilot/copilot-conversations/chat.md" });
      const other = mockTFile({ path: "notes/idea.md" });
      const app = {
        vault: {
          getAbstractFileByPath: (path: string) => (path === folder.path ? folder : null),
          getMarkdownFiles: () => [chat, other],
        },
      } as unknown as App;

      expect(listMarkdownFiles(app, folder.path)).toEqual([chat]);
    });

    it("returns no notes for a folder the vault does not have", () => {
      const app = { vault: { getAbstractFileByPath: () => null } } as unknown as App;

      expect(listMarkdownFiles(app, "copilot/copilot-conversations")).toEqual([]);
    });
  });

  describe("patchFrontmatter()", () => {
    it("https://github.com/logancyang/obsidian-copilot/issues/3195 sets and removes keys through Obsidian's frontmatter API", async () => {
      const note = mockTFile({ path: "chats/agent__a.md" });
      const frontmatter: Record<string, unknown> = { topic: "Plan", pinnedAt: 1_000 };

      await patchFrontmatter(makeNoteApp(note, frontmatter), note.path, {
        topic: "Renamed",
        pinnedAt: null,
      });

      expect(frontmatter).toEqual({ topic: "Renamed" });
    });

    it("leaves the vault untouched for a path that is not a note", async () => {
      const note = mockTFile({ path: "chats/agent__a.md" });
      const app = makeNoteApp(note, {});

      await patchFrontmatter(app, "chats/missing.md", { topic: "Renamed" });

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });
  });
});
