import { mentionsInText } from "@/components/chat-components/mentionsInText";
import { TFile, TFolder, type App } from "obsidian";

const file = (path: string): TFile => new (TFile as unknown as new (path: string) => TFile)(path);
const folder = (path: string): TFolder =>
  new (TFolder as unknown as new (path: string) => TFolder)(path);

function makeApp(): App {
  const links = new Map([
    ["Plan", file("Notes/Plan.md")],
    ["Spec.pdf", file("Docs/Spec.pdf")],
  ]);
  const folders = new Map([["Research/Pricing", folder("Research/Pricing")]]);
  return {
    metadataCache: { getFirstLinkpathDest: (linkpath: string) => links.get(linkpath) ?? null },
    vault: { getAbstractFileByPath: (path: string) => folders.get(path) ?? null },
  } as unknown as App;
}

describe("mentionsInText", () => {
  describe("mentionsInText()", () => {
    it("finds nothing in text without mentions", () => {
      expect(mentionsInText(makeApp(), "compare the notes", new Set())).toEqual({
        notes: [],
        folders: [],
      });
    });

    it("finds the notes and folders a restored draft mentions as plain text, each once (https://github.com/Brevilabs/obsidian-copilot-private/issues/932)", () => {
      const found = mentionsInText(
        makeApp(),
        "Compare [[Plan]] and [[Plan|the plan]] with [[Spec.pdf]] in {Research/Pricing} and {Research/Pricing}",
        new Set()
      );

      expect(found.notes.map((note) => note.path)).toEqual(["Notes/Plan.md", "Docs/Spec.pdf"]);
      expect(found.folders).toEqual(["Research/Pricing"]);
    });

    it("skips a note mention a pill already resolved, and brackets or braces that name nothing in the vault (https://github.com/Brevilabs/obsidian-copilot-private/issues/932)", () => {
      const found = mentionsInText(
        makeApp(),
        "Use [[Plan]] not [[Missing]] and keep {activeNote} and {Unknown/Folder}",
        new Set(["[[Plan]]"])
      );

      expect(found).toEqual({ notes: [], folders: [] });
    });
  });
});
