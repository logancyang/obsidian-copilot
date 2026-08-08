import { PropertySearchModal, PropertyValueModal } from "@/components/modals/PropertySearchModal";
import { App, TFile } from "obsidian";

interface FakeNote {
  path: string;
  frontmatter?: Record<string, unknown>;
}

/** Build a minimal App exposing only the vault + metadataCache surface the two
 * property modals read: markdown files and each file's frontmatter cache. The
 * modals treat a file as an opaque handle (they only read `.path`), so plain
 * path stubs stand in for real TFile instances. */
function makeApp(notes: FakeNote[]): App {
  const files = notes.map((n) => ({ path: n.path }));
  const frontmatterByPath = new Map(notes.map((n) => [n.path, n.frontmatter]));
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const frontmatter = frontmatterByPath.get(file.path);
        return frontmatter ? { frontmatter } : null;
      },
    },
  } as unknown as App;
}

describe("PropertySearchModal", () => {
  describe("PropertySearchModal", () => {
    describe("getItems()", () => {
      it("returns the vault's distinct frontmatter keys, sorted", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics", Subject: "Einstein" } },
          { path: "b.md", frontmatter: { Topics: "Chemistry" } },
          { path: "c.md" }, // no frontmatter — contributes nothing
        ]);
        const modal = new PropertySearchModal(app, jest.fn());

        expect(modal.getItems()).toEqual(["Subject", "Topics"]);
      });

      it("excludes Obsidian's injected `position` frontmatter key", () => {
        // Obsidian's metadata cache adds a `position` key to every frontmatter
        // object; it must not appear as a selectable property.
        const app = makeApp([
          { path: "a.md", frontmatter: { position: { start: 0 }, Topics: "Physics" } },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Topics"]);
      });

      it("omits keys the [key:value] grammar cannot represent (colon/brackets)", () => {
        // A frontmatter key containing ":" would be misparsed by the pattern
        // grammar, so it must not be offered for selection.
        const app = makeApp([
          { path: "a.md", frontmatter: { "a:b": "x", Topics: "Physics", "c[d]": "y" } },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Topics"]);
      });

      it("omits keys with leading or trailing whitespace", () => {
        // parsePropertyPattern trims the key, so " Topics " would be stored as
        // "Topics" and never match; such keys must not be offered.
        const app = makeApp([{ path: "a.md", frontmatter: { " Topics ": "x", Subject: "y" } }]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Subject"]);
      });

      it("omits an empty-string key", () => {
        // `"": Physics` is valid YAML, but `[:Physics]` has no key segment and
        // would be reclassified as a folder pattern, so it must not be offered.
        const app = makeApp([{ path: "a.md", frontmatter: { "": "Physics", Subject: "y" } }]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Subject"]);
      });

      it("omits keys that only exist under a system Copilot root", () => {
        // Saved chats live in the Copilot root and carry their own frontmatter, but
        // `shouldIndexFile` drops them, so a key sourced only from there would be
        // selectable while matching no note. Both picker steps enumerate the same
        // candidate set as the materializer.
        const app = makeApp([
          { path: "Notes/a.md", frontmatter: { Topics: "Physics" } },
          { path: "copilot/copilot-conversations/chat.md", frontmatter: { mode: "agent" } },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Topics"]);
      });

      it("returns an empty list when no note has frontmatter", () => {
        const modal = new PropertySearchModal(makeApp([{ path: "a.md" }]), jest.fn());
        expect(modal.getItems()).toEqual([]);
      });
    });

    describe("getItemText()", () => {
      it("shows the key verbatim", () => {
        const modal = new PropertySearchModal(makeApp([]), jest.fn());
        expect(modal.getItemText("Topics")).toBe("Topics");
      });
    });

    describe("onChooseItem()", () => {
      it("defers to the value step without emitting a pattern yet", () => {
        const onChoose = jest.fn();
        const app = makeApp([{ path: "a.md", frontmatter: { Topics: "Physics" } }]);
        const modal = new PropertySearchModal(app, onChoose);

        modal.onChooseItem("Topics");

        // Choosing a key opens the value picker; the pattern is only built once a
        // value (or "any value") is chosen there.
        expect(onChoose).not.toHaveBeenCalled();
      });
    });
  });

  describe("PropertyValueModal", () => {
    describe("getItems()", () => {
      it("leads with the any-value choice, then the key's distinct sorted values", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics" } },
          { path: "b.md", frontmatter: { Topics: ["Chemistry", "Physics"] } }, // list expands, dedupes
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Chemistry", "Physics"]);
      });

      it("omits values that cannot round-trip through the [key:value] grammar", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics" } },
          { path: "empty.md", frontmatter: { Topics: "" } }, // trims to "" → would flip to key-only [Topics:]
          { path: "blank.md", frontmatter: { Topics: "   " } }, // whitespace-only, trims to ""
          { path: "multi.md", frontmatter: { Topics: "line one\nline two" } }, // internal newline → folder fallthrough
          { path: "ls.md", frontmatter: { Topics: "a\u2028b" } }, // U+2028 line separator, also unmatched by regex `.`
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Physics"]);
      });

      it("trims surrounding whitespace so a padded value round-trips as its matcher form", () => {
        // The matcher trims both sides, so a block scalar's trailing newline (or
        // any surrounding whitespace) must not hide an otherwise-selectable value;
        // it is normalized and deduped against the same value elsewhere.
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics\n" } }, // YAML block scalar trailing newline
          { path: "b.md", frontmatter: { Topics: "  Physics  " } },
          { path: "c.md", frontmatter: { Topics: "Chemistry" } },
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Chemistry", "Physics"]);
      });
      it("omits values that only exist under a system Copilot root", () => {
        // The value step must use the same candidate set as the key step and the
        // materializer; otherwise a chat-only value would be offered and then match
        // nothing once the materializer filters that note out.
        const app = makeApp([
          { path: "Notes/a.md", frontmatter: { Topics: "Physics" } },
          { path: "copilot/copilot-conversations/chat.md", frontmatter: { Topics: "ChatOnly" } },
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Physics"]);
      });
    });

    describe("getItemText()", () => {
      it("labels the any-value choice and shows a real value verbatim", () => {
        const modal = new PropertyValueModal(makeApp([]), "Topics", jest.fn());
        expect(modal.getItemText(null)).toBe("Any value — notes that declare this key");
        expect(modal.getItemText("Physics")).toBe("Physics");
      });

      it("keeps the any-value label distinct from a note whose value is literally that text", () => {
        // Both entries are offered together, and they build very different patterns
        // ([Topics:] vs [Topics:(any value)]), so their labels must never coincide.
        const app = makeApp([{ path: "Notes/a.md", frontmatter: { Topics: "(any value)" } }]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "(any value)"]);
        expect(modal.getItemText("(any value)")).not.toBe(modal.getItemText(null));
      });
    });

    describe("onChooseItem()", () => {
      it("emits a key:value pattern for a chosen value", () => {
        const onChoose = jest.fn();
        const modal = new PropertyValueModal(makeApp([]), "Topics", onChoose);

        modal.onChooseItem("Physics");

        expect(onChoose).toHaveBeenCalledWith("[Topics:Physics]");
      });

      it("emits a key-only pattern for the any-value choice", () => {
        const onChoose = jest.fn();
        const modal = new PropertyValueModal(makeApp([]), "Topics", onChoose);

        modal.onChooseItem(null);

        expect(onChoose).toHaveBeenCalledWith("[Topics:]");
      });
    });
  });
});
