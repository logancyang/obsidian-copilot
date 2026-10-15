import type { App } from "obsidian";
import { FileSystemAdapter, Platform } from "obsidian";
import * as fs from "node:fs";
import * as path from "node:path";
import { getVaultId } from "@/utils/appPaths";
import { clearLegacyCaches } from "./legacyCaches";

let mockHome = "";
jest.mock("os", () => ({
  ...jest.requireActual<typeof import("os")>("os"),
  homedir: () => mockHome,
}));

const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;

describe("legacyCaches", () => {
  describe("clearLegacyCaches()", () => {
    const vaultFolders = new Set<string>();
    const adapter = Object.assign(new FsAdapter("/Users/me/My Vault"), {
      exists: jest.fn(async (p: string) => vaultFolders.has(p)),
      rmdir: jest.fn(async (p: string) => {
        vaultFolders.delete(p);
      }),
    });
    const app = { vault: { adapter } } as unknown as App;
    const contextCacheDir = () =>
      path.join(mockHome, ".obsidian-copilot", "vaults", getVaultId(app), "context-cache");

    beforeEach(() => {
      vaultFolders.clear();
      jest.clearAllMocks();
      mockHome = fs.mkdtempSync(
        path.join(jest.requireActual<typeof import("os")>("os").tmpdir(), "copilot-cache-home-")
      );
    });

    afterEach(() => {
      Platform.isMobile = false;
      fs.rmSync(mockHome, { recursive: true, force: true });
    });

    it("deletes the in-vault PDF cache folder and the off-vault context cache folder", async () => {
      vaultFolders.add(".copilot/pdf-cache");
      fs.mkdirSync(path.join(contextCacheDir(), "remotes"), { recursive: true });
      fs.writeFileSync(path.join(contextCacheDir(), "remotes", "web-1.md"), "old snapshot");

      await clearLegacyCaches(app);

      expect(adapter.rmdir).toHaveBeenCalledWith(".copilot/pdf-cache", true);
      expect(fs.existsSync(contextCacheDir())).toBe(false);
      expect(fs.existsSync(path.dirname(contextCacheDir()))).toBe(true);
    });

    it("resolves without deleting anything when neither cache folder exists", async () => {
      await expect(clearLegacyCaches(app)).resolves.toBeUndefined();
      expect(adapter.rmdir).not.toHaveBeenCalled();
    });

    it("deletes only the in-vault PDF cache folder on mobile, where the off-vault cache never existed", async () => {
      Platform.isMobile = true;
      vaultFolders.add(".copilot/pdf-cache");
      fs.mkdirSync(contextCacheDir(), { recursive: true });

      await clearLegacyCaches(app);

      expect(adapter.rmdir).toHaveBeenCalledWith(".copilot/pdf-cache", true);
      expect(fs.existsSync(contextCacheDir())).toBe(true);
    });
  });
});
