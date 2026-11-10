import { TagSearchModal } from "@/components/modals/TagSearchModal";
import { App, TFile } from "obsidian";

function makeApp(caches: Record<string, unknown>): App {
  const files = Object.keys(caches).map((path) => ({ path }));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (file: TFile) => caches[file.path] ?? null },
  } as unknown as App;
}

describe("TagSearchModal", () => {
  describe("TagSearchModal", () => {
    describe("getItems()", () => {
      it("lists each tag once, whether a note carries it in its properties or inline in its text", () => {
        const modal = new TagSearchModal(
          makeApp({
            "brief.md": { frontmatter: { tags: ["launch", "q4"] } },
            "standup.md": { tags: [{ tag: "#standup" }, { tag: "#launch" }] },
          }),
          jest.fn()
        );

        expect(modal.getItems().sort()).toEqual(["launch", "q4", "standup"]);
      });
    });
  });
});
