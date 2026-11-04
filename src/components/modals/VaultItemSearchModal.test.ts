import { VaultItemSearchModal } from "@/components/modals/VaultItemSearchModal";
import { App, TAbstractFile, TFile, TFolder } from "obsidian";

function makeFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeApp(items: TAbstractFile[]): App {
  return { vault: { getAllLoadedFiles: () => items } } as unknown as App;
}

describe("VaultItemSearchModal", () => {
  describe("VaultItemSearchModal", () => {
    const root = makeFolder("/");
    const research = makeFolder("Research");
    const nested = makeFolder("Clients/Northwind/Research");
    const note = makeFile("Meetings/Q3 retro.md");
    const pdf = makeFile("Research/deck.pdf");

    describe("getItems()", () => {
      it("offers every vault note, file and folder at any depth, but not the vault root", () => {
        const modal = new VaultItemSearchModal(
          makeApp([root, research, nested, note, pdf]),
          jest.fn()
        );

        expect(modal.getItems()).toEqual([research, nested, note, pdf]);
      });
    });

    describe("getItemText()", () => {
      it("shows each item by its full vault path, with a trailing slash for folders", () => {
        const modal = new VaultItemSearchModal(makeApp([]), jest.fn());

        expect(modal.getItemText(nested)).toBe("Clients/Northwind/Research/");
        expect(modal.getItemText(note)).toBe("Meetings/Q3 retro.md");
      });
    });

    describe("onChooseItem()", () => {
      it("hands the chosen item to the caller", () => {
        const onChoose = jest.fn();
        const modal = new VaultItemSearchModal(makeApp([]), onChoose);

        modal.onChooseItem(nested);

        expect(onChoose).toHaveBeenCalledWith(nested);
      });
    });
  });
});
