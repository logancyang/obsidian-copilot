import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { getVaultId } from "@/utils/appPaths";
import { md5 } from "@/utils/hash";
import {
  cacheRoot,
  filesDir,
  markersDir,
  remotesDir,
  snapshotAbsPath,
} from "./conversionsLocation";

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

  describe("remotesDir() and filesDir()", () => {
    it("place the remotes and files directories directly under the cache root", () => {
      const root = cacheRoot(app);
      expect(remotesDir(app)).toBe(path.join(root, "remotes"));
      expect(filesDir(app)).toBe(path.join(root, "files"));
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
    it("places file snapshots in filesDir and remote snapshots in remotesDir", () => {
      expect(snapshotAbsPath(app, "file", "file-1.md")).toBe(path.join(filesDir(app), "file-1.md"));
      expect(snapshotAbsPath(app, "web", "web-1.md")).toBe(path.join(remotesDir(app), "web-1.md"));
      expect(snapshotAbsPath(app, "youtube", "youtube-1.md")).toBe(
        path.join(remotesDir(app), "youtube-1.md")
      );
    });
  });
});
