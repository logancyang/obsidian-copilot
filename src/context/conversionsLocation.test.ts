import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { getVaultId } from "@/utils/appPaths";
import { md5 } from "@/utils/hash";
import { cacheRoot, markersDir, remotesDir, snapshotAbsPath } from "./conversionsLocation";

const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
const appWith = (basePath: string): App =>
  ({ vault: { adapter: new FsAdapter(basePath) } }) as unknown as App;

describe("conversionsLocation", () => {
  const app = appWith("/Users/me/My Vault");

  describe("cacheRoot()", () => {
    it("roots the cache at ~/.obsidian-copilot/vaults/<vaultId>/context-cache", () => {
      const root = cacheRoot(app);
      expect(
        root.endsWith(path.join(".obsidian-copilot", "vaults", getVaultId(app), "context-cache"))
      ).toBe(true);
    });
  });

  describe("remotesDir()", () => {
    it("places the remotes directory directly under the cache root", () => {
      expect(remotesDir(app)).toBe(path.join(cacheRoot(app), "remotes"));
    });
  });

  describe("markersDir()", () => {
    it("buckets failure markers under markers/<md5(projectId)>, never the raw project id", () => {
      const dir = markersDir(app, "proj-1");
      expect(dir).toBe(path.join(cacheRoot(app), "markers", md5("proj-1")));
      expect(dir).not.toContain("proj-1");
    });
  });

  describe("snapshotAbsPath()", () => {
    it("places a snapshot in remotesDir", () => {
      expect(snapshotAbsPath(app, "web-1.md")).toBe(path.join(remotesDir(app), "web-1.md"));
    });
  });
});
