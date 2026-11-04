import { VaultItemSearchModal } from "@/components/modals/VaultItemSearchModal";
import { App, CachedMetadata, TAbstractFile, TFile, TFolder } from "obsidian";

function makeFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeApp(items: TAbstractFile[], caches: Record<string, unknown> = {}): App {
  return {
    vault: {
      getAllLoadedFiles: () => items,
      getMarkdownFiles: () =>
        items.filter((item): item is TFile => item instanceof TFile && item.extension === "md"),
    },
    metadataCache: {
      getFileCache: (file: TFile) => (caches[file.path] as CachedMetadata | undefined) ?? null,
    },
  } as unknown as App;
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

      it("offers each tag used in the vault once in any case, from properties or inline, after the files and folders — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
        const brief = makeFile("Plans/brief.md");
        const modal = new VaultItemSearchModal(
          makeApp([note, brief], {
            "Meetings/Q3 retro.md": { tags: [{ tag: "#launch" }, { tag: "#Retro" }] },
            "Plans/brief.md": { frontmatter: { tags: ["Launch", "q4/plan"] } },
          }),
          jest.fn()
        );

        expect(modal.getItems()).toEqual([note, brief, "#launch", "#Retro", "#q4/plan"]);
      });
    });

    describe("getSuggestions()", () => {
      it("offers each pasted web or YouTube link as a link to save, classified by its address — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
        const modal = new VaultItemSearchModal(makeApp([research, note]), jest.fn());

        const suggestions = modal.getSuggestions(
          "https://example.com/pricing and https://youtu.be/dQw4w9WgXcQ"
        );

        expect(suggestions.map(({ item }) => item)).toEqual([
          {
            id: "web:https://example.com/pricing",
            url: "https://example.com/pricing",
            type: "web",
          },
          {
            id: "youtube:https://youtu.be/dQw4w9WgXcQ",
            url: "https://youtu.be/dQw4w9WgXcQ",
            type: "youtube",
          },
        ]);
      });

      it("searches notes, folders and tags by name when the text holds no http link, so a file name such as tiers.md is never read as a web address", () => {
        const tiers = makeFile("Research/tiers.md");
        const modal = new VaultItemSearchModal(makeApp([research, tiers]), jest.fn());

        expect(modal.getSuggestions("tiers.md").map(({ item }) => item)).toEqual([tiers]);
      });
    });

    describe("getItemText()", () => {
      it("shows a note or folder by its full vault path with a trailing slash for folders, a tag by its name, and a link by its address", () => {
        const modal = new VaultItemSearchModal(makeApp([]), jest.fn());

        expect(modal.getItemText(nested)).toBe("Clients/Northwind/Research/");
        expect(modal.getItemText(note)).toBe("Meetings/Q3 retro.md");
        expect(modal.getItemText("#launch")).toBe("#launch");
        expect(
          modal.getItemText({ id: "web:https://a.com", url: "https://a.com", type: "web" })
        ).toBe("https://a.com");
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
