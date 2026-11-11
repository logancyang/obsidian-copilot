import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { presentAntigravityToolTitle } from "./antigravityToolTitles";

function vaultApp(basePath: string): App {
  const adapter = new FileSystemAdapter();
  adapter.getBasePath = () => basePath;
  return { vault: { adapter } } as unknown as App;
}

describe("antigravityToolTitles", () => {
  beforeEach(() => __resetVaultBaseCache());
  afterEach(() => __resetVaultBaseCache());

  describe("presentAntigravityToolTitle()", () => {
    it("names an edit by its vault-relative note instead of agy's slashless absolute path", () => {
      expect(
        presentAntigravityToolTitle(vaultApp("/Users/me/vault"), {
          kind: "edit",
          locations: [{ path: "/Users/me/vault/Spike/alpha.md" }],
        })
      ).toBe("Edit Spike/alpha.md");
    });

    it("keeps agy's own title for a call that is not an edit of a known file", () => {
      const app = vaultApp("/Users/me/vault");

      expect(presentAntigravityToolTitle(app, { kind: "execute", locations: [] })).toBeUndefined();
      expect(presentAntigravityToolTitle(app, { kind: "edit", locations: [] })).toBeUndefined();
    });
  });
});
