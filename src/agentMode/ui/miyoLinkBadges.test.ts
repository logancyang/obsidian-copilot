import { addMiyoBadgeHosts, miyoVaultPaths } from "@/agentMode/ui/miyoLinkBadges";
import { setSettings } from "@/settings/model";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

jest.mock("@/utils/vaultPath", () => ({
  ...jest.requireActual("@/utils/vaultPath"),
  getVaultBase: jest.fn(),
}));

const VAULT_BASE = "/Users/me/step-2";

function makeApp(files: Record<string, string>): App {
  return {
    vault: { getName: () => "step-2" },
    metadataCache: {
      getFirstLinkpathDest: jest.fn((linkpath: string) => {
        const path = files[linkpath];
        return path ? { path } : null;
      }),
    },
  } as unknown as App;
}

describe("miyoLinkBadges", () => {
  beforeEach(() => {
    jest.mocked(getVaultBase).mockReturnValue(VAULT_BASE);
    setSettings({ miyoExtraSearchFolders: ["Archive"] });
  });

  afterEach(() => {
    setSettings({ miyoExtraSearchFolders: [] });
  });

  describe("miyoVaultPaths()", () => {
    const app = makeApp({});

    it("strips the vault folder Miyo prefixes onto each result path (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([...miyoVaultPaths(app, ["step-2/notes/Standing desk setup.md"])]).toEqual([
        "notes/Standing desk setup.md",
      ]);
    });

    it("keeps a vault-relative path as it is", () => {
      expect([...miyoVaultPaths(app, ["notes/Standing desk setup.md"])]).toEqual([
        "notes/Standing desk setup.md",
      ]);
    });

    it("turns an absolute path inside the vault into a vault-relative path (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([...miyoVaultPaths(app, [`${VAULT_BASE}/notes/Standing desk setup.md`])]).toEqual([
        "notes/Standing desk setup.md",
      ]);
    });

    it("drops an absolute path outside the vault (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([
        ...miyoVaultPaths(app, ["/Users/me/other-vault/notes/Standing desk setup.md"]),
      ]).toEqual([]);
    });

    it("drops results from a configured extra Miyo folder and keeps other paths as they are (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([
        ...miyoVaultPaths(app, ["Archive/notes/Old.md", "copilot-test-vault/edit-eval/a.md"]),
      ]).toEqual(["copilot-test-vault/edit-eval/a.md"]);
    });

    it("under Unrestricted scope, drops a relative path without the vault prefix because it may come from any Miyo folder (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      setSettings({ miyoSearchAll: true });
      try {
        expect([
          ...miyoVaultPaths(app, ["Work/meeting.md", "step-2/notes/Standing desk setup.md"]),
        ]).toEqual(["notes/Standing desk setup.md"]);
      } finally {
        setSettings({ miyoSearchAll: false });
      }
    });

    it("reads Windows backslash paths the same as forward-slash paths (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([
        ...miyoVaultPaths(app, ["step-2\\notes\\Standing desk setup.md", "Archive\\notes\\Old.md"]),
      ]).toEqual(["notes/Standing desk setup.md"]);
    });

    it("strips only the vault-name prefix when a top-level vault folder has the vault's name (https://github.com/Brevilabs/obsidian-copilot-private/issues/719)", () => {
      expect([...miyoVaultPaths(app, ["step-2/step-2/Trip.md"])]).toEqual(["step-2/Trip.md"]);
    });
  });

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
