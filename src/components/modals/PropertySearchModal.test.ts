import { PropertySearchModal, PropertyValueModal } from "@/components/modals/PropertySearchModal";
import { App, TFile } from "obsidian";

interface FakeNote {
  path: string;
  frontmatter?: Record<string, unknown>;
}

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
          { path: "c.md" },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());

        expect(modal.getItems()).toEqual(["Subject", "Topics"]);
      });

      it("excludes Obsidian's injected `position` frontmatter key", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { position: { start: 0 }, Topics: "Physics" } },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Topics"]);
      });

      it("omits keys the [key:value] grammar cannot represent (colon/brackets)", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { "a:b": "x", Topics: "Physics", "c[d]": "y" } },
        ]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Topics"]);
      });

      it("omits keys with leading or trailing whitespace", () => {
        const app = makeApp([{ path: "a.md", frontmatter: { " Topics ": "x", Subject: "y" } }]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Subject"]);
      });

      it("omits an empty-string key", () => {
        const app = makeApp([{ path: "a.md", frontmatter: { "": "Physics", Subject: "y" } }]);
        const modal = new PropertySearchModal(app, jest.fn());
        expect(modal.getItems()).toEqual(["Subject"]);
      });

      it("omits keys that only exist under a system Copilot root", () => {
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

        expect(onChoose).not.toHaveBeenCalled();
      });
    });
  });

  describe("PropertyValueModal", () => {
    describe("getItems()", () => {
      it("leads with the any-value choice, then the key's distinct sorted values", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics" } },
          { path: "b.md", frontmatter: { Topics: ["Chemistry", "Physics"] } },
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Chemistry", "Physics"]);
      });

      it("omits values that cannot round-trip through the [key:value] grammar", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics" } },
          { path: "empty.md", frontmatter: { Topics: "" } },
          { path: "blank.md", frontmatter: { Topics: "   " } },
          { path: "multi.md", frontmatter: { Topics: "line one\nline two" } },
          { path: "ls.md", frontmatter: { Topics: "a\u2028b" } },
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Physics"]);
      });

      it("trims surrounding whitespace so a padded value round-trips as its matcher form", () => {
        const app = makeApp([
          { path: "a.md", frontmatter: { Topics: "Physics\n" } },
          { path: "b.md", frontmatter: { Topics: "  Physics  " } },
          { path: "c.md", frontmatter: { Topics: "Chemistry" } },
        ]);
        const modal = new PropertyValueModal(app, "Topics", jest.fn());

        expect(modal.getItems()).toEqual([null, "Chemistry", "Physics"]);
      });
      it("omits values that only exist under a system Copilot root", () => {
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
