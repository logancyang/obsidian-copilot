import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as fs from "node:fs";
import * as path from "node:path";
import { getVaultId } from "@/utils/appPaths";
import { clearContextCache } from "./conversionsLocation";

let mockHome = "";
jest.mock("os", () => ({
  ...jest.requireActual<typeof import("os")>("os"),
  homedir: () => mockHome,
}));

const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
const appWith = (basePath: string): App =>
  ({ vault: { adapter: new FsAdapter(basePath) } }) as unknown as App;

describe("conversionsLocation", () => {
  const app = appWith("/Users/me/My Vault");

  beforeEach(() => {
    mockHome = fs.mkdtempSync(
      path.join(jest.requireActual<typeof import("os")>("os").tmpdir(), "copilot-cache-home-")
    );
  });

  afterEach(() => {
    fs.rmSync(mockHome, { recursive: true, force: true });
  });

  describe("clearContextCache()", () => {
    it("deletes this vault's context-cache folder with every snapshot and marker in it", async () => {
      const vaultDir = path.join(mockHome, ".obsidian-copilot", "vaults", getVaultId(app));
      const root = path.join(vaultDir, "context-cache");
      fs.mkdirSync(path.join(root, "remotes"), { recursive: true });
      fs.writeFileSync(path.join(root, "remotes", "web-1.md"), "old snapshot");

      await clearContextCache(app);

      expect(fs.existsSync(root)).toBe(false);
      expect(fs.existsSync(vaultDir)).toBe(true);
    });

    it("resolves without error when the vault has no context-cache folder", async () => {
      await expect(clearContextCache(app)).resolves.toBeUndefined();
    });
  });
});
