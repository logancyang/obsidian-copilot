import { addMiyoBadgeHosts } from "@/miyo/miyoLinkBadges";
import type { App } from "obsidian";

function makeApp(files: Record<string, string>): App {
  return {
    metadataCache: {
      getFirstLinkpathDest: jest.fn((linkpath: string) => {
        const path = files[linkpath];
        return path ? { path } : null;
      }),
    },
  } as unknown as App;
}

describe("miyoLinkBadges", () => {
  describe("addMiyoBadgeHosts()", () => {
    const FILES = {
      "notes/Standing desk setup": "notes/Standing desk setup.md",
      "notes/Standing desk setup.md": "notes/Standing desk setup.md",
      "notes/Reading list": "notes/Reading list.md",
    };
    const FOUND = new Set(["notes/Standing desk setup.md"]);

    interface LinkSpec {
      href: string;
      text: string;
      cls?: string;
    }

    function render(links: LinkSpec[], files: Record<string, string> = FILES) {
      const container = document.createElement("div");
      for (const { href, text, cls = "internal-link" } of links) {
        container.createEl("a", { cls, text, attr: { "data-href": href, href } });
      }
      const hosts = addMiyoBadgeHosts(makeApp(files), container, "", FOUND);
      return { container, hosts };
    }

    const DESK = { href: "notes/Standing desk setup", text: "Standing desk setup" };

    it("puts a badge host right before a wikilink that resolves to a Miyo-found note", () => {
      const { container, hosts } = render([DESK]);
      expect(hosts).toHaveLength(1);
      expect(container.firstElementChild).toBe(hosts[0]);
    });

    it("badges an aliased wikilink, a heading wikilink and a Markdown link with URL-encoded spaces", () => {
      const { hosts } = render([
        { ...DESK, text: "my desk" },
        { href: "notes/Standing desk setup#Fixes", text: "Standing desk setup > Fixes" },
        { href: "notes/Standing%20desk%20setup.md", text: "desk" },
      ]);
      expect(hosts).toHaveLength(3);
    });

    it("badges every link to the same note", () => {
      expect(render([DESK, DESK]).hosts).toHaveLength(2);
    });

    it("leaves links to notes Miyo did not return, unresolved links and external links unbadged", () => {
      const { hosts } = render([
        { href: "notes/Reading list", text: "Reading list" },
        {
          href: "Create And Jump Into A Directory",
          text: "Create And Jump Into A Directory",
          cls: "internal-link is-unresolved",
        },
        {
          href: "https://example.com/notes/Standing desk setup",
          text: "web",
          cls: "external-link",
        },
      ]);
      expect(hosts).toEqual([]);
    });
  });
});
