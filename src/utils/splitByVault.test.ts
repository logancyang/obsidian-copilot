import { FileSystemAdapter, TFile, TFolder, type App } from "obsidian";
import { splitByVault } from "@/utils/splitByVault";
import { __resetVaultBaseCache } from "@/utils/vaultPath";

const mockOsPaths = new Map<File, string>();
jest.mock(
  "electron",
  () => ({ webUtils: { getPathForFile: (file: File) => mockOsPaths.get(file) ?? "" } }),
  { virtual: true }
);

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

function droppedFile(name: string, osPath?: string): File {
  const file = new File([name], name);
  if (osPath) mockOsPaths.set(file, osPath);
  return file;
}

function entry(isDirectory: boolean): DataTransferItem {
  return { kind: "file", webkitGetAsEntry: () => ({ isDirectory }) } as unknown as DataTransferItem;
}

function makeApp({
  draggable = null,
  vaultItems = [],
}: { draggable?: unknown; vaultItems?: (TFile | TFolder)[] } = {}): App {
  return {
    dragManager: { draggable },
    vault: {
      adapter: new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
        "/Users/me/Vault"
      ),
      getAbstractFileByPath: (path: string) =>
        vaultItems.find((item) => item.path === path) ?? null,
    },
  } as unknown as App;
}

describe("splitByVault", () => {
  beforeEach(() => {
    __resetVaultBaseCache();
    mockOsPaths.clear();
  });

  describe("splitByVault()", () => {
    it("returns the note Obsidian is dragging from its file explorer as a vault item", () => {
      const note = makeFile("Meetings/Q3 retro.md");

      expect(
        splitByVault(makeApp({ draggable: { type: "file", file: note } }), { files: [] })
      ).toEqual({ vaultItems: [note], outsideFiles: [], outsideFolderNames: [] });
    });

    it("returns the folder Obsidian is dragging as its own object, so a nested folder keeps its full path — https://github.com/logancyang/obsidian-copilot/issues/3089", () => {
      const nested = makeFolder("Clients/Northwind/Research");

      expect(
        splitByVault(makeApp({ draggable: { type: "folder", file: nested } }), { files: [] })
          .vaultItems
      ).toEqual([nested]);
    });

    it("returns every item of a multi-item drag and the note a Copilot row's link drag carries", () => {
      const note = makeFile("Meetings/Q3 retro.md");
      const folder = makeFolder("Research/Pricing");

      expect(
        splitByVault(makeApp({ draggable: { type: "files", files: [note, folder] } }), {
          files: [],
        }).vaultItems
      ).toEqual([note, folder]);
      expect(
        splitByVault(makeApp({ draggable: { type: "link", linktext: "Q3 retro", file: note } }), {
          files: [],
        }).vaultItems
      ).toEqual([note]);
    });

    it("keeps a file from the computer as an outside file, whatever text the drag carries beside it, as WeChat sends its name — https://github.com/Brevilabs/obsidian-copilot-private/issues/898", () => {
      const report = droppedFile("report.pdf", "/Users/me/Library/WeChat/temp/drag/report.pdf");

      expect(splitByVault(makeApp(), { files: [report], items: [entry(false)] })).toEqual({
        vaultItems: [],
        outsideFiles: [report],
        outsideFolderNames: [],
      });
    });

    it("returns a file dropped from the computer that already lives in the vault as that vault file, so it is not copied again", () => {
      const inVault = makeFile("Papers/report.pdf");
      const report = droppedFile("report.pdf", "/Users/me/Vault/Papers/report.pdf");

      expect(splitByVault(makeApp({ vaultItems: [inVault] }), { files: [report] })).toEqual({
        vaultItems: [inVault],
        outsideFiles: [],
        outsideFolderNames: [],
      });
    });

    it("keeps an outside file that has no OS path, as on mobile, as an outside file", () => {
      const report = droppedFile("report.pdf");

      expect(splitByVault(makeApp(), { files: [report] }).outsideFiles).toEqual([report]);
    });

    it("keeps vault items and outside files from the same drop together instead of dropping either — https://github.com/Brevilabs/obsidian-copilot-private/issues/898", () => {
      const note = makeFile("Meetings/Q3 retro.md");
      const report = droppedFile("report.pdf", "/Users/me/Downloads/report.pdf");

      expect(
        splitByVault(makeApp({ draggable: { type: "file", file: note } }), { files: [report] })
      ).toEqual({ vaultItems: [note], outsideFiles: [report], outsideFolderNames: [] });
    });

    it("lists a vault item once when the drag manager and the dropped file both name it", () => {
      const note = makeFile("Papers/report.pdf");
      const report = droppedFile("report.pdf", "/Users/me/Vault/Papers/report.pdf");

      expect(
        splitByVault(makeApp({ draggable: { type: "file", file: note }, vaultItems: [note] }), {
          files: [report],
        }).vaultItems
      ).toEqual([note]);
    });

    it("sets folders from outside the vault aside by name and keeps the files dropped with them — https://github.com/Brevilabs/obsidian-copilot-private/issues/897", () => {
      const notes = droppedFile("notes.pdf");

      expect(
        splitByVault(makeApp(), {
          files: [droppedFile("my-codebase"), notes],
          items: [entry(true), entry(false)],
        })
      ).toEqual({ vaultItems: [], outsideFiles: [notes], outsideFolderNames: ["my-codebase"] });
    });

    it("returns nothing when neither Obsidian nor the computer sends a file, as for a drag of plain text", () => {
      expect(
        splitByVault(makeApp({ draggable: { type: "link", linktext: "x" } }), { files: [] })
      ).toEqual({ vaultItems: [], outsideFiles: [], outsideFolderNames: [] });
      expect(splitByVault({ vault: makeApp().vault } as App, { files: [] }).vaultItems).toEqual([]);
    });
  });
});
